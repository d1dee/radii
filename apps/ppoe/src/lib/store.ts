import type {
    AdminContactsSettings,
    Packages,
    PppoeClient,
    PppoeServiceConfig,
    Quota,
} from '@radii/shared';
import { ApiErrorType, defaultAdminSettings } from '@radii/shared';
import { useEffect, useSyncExternalStore } from 'react';
import {
    currentNasDeviceId,
    getClientData,
    getClients,
    getContacts,
    getPackages,
    getServiceConfig,
    getStatus,
    setNasDeviceId,
    type Client,
} from './api.ts';
import { storeLogger } from './logging.ts';

type PortalSnapshot = {
    client: Client | undefined;
    clientError: string | null;
    packages: Packages | undefined;
    packagesError: string | null;
    packagesLoading: boolean;
    contacts: AdminContactsSettings;
    contactsError: string | null;
};

type AccountSnapshot = {
    clients: PppoeClient[];
    selectedAccountId: string | null;
    config: PppoeServiceConfig | null;
    loading: boolean;
    error: string | null;
};

type QuotaSnapshot = { quota: Quota[]; loading: boolean; error: string | null };

type ScopeSnapshot = { nasDeviceId: string | null };

let portalSnapshot: PortalSnapshot = {
    client: undefined,
    clientError: null,
    packages: undefined,
    packagesError: null,
    packagesLoading: true,
    contacts: defaultAdminSettings.contacts,
    contactsError: null,
};
let scopeSnapshot: ScopeSnapshot = {
    nasDeviceId: currentNasDeviceId(),
};
let accountSnapshot: AccountSnapshot = {
    clients: [],
    selectedAccountId: null,
    config: null,
    loading: true,
    error: null,
};
let quotaSnapshot: QuotaSnapshot = { quota: [], loading: true, error: null };

const portalListeners = new Set<() => void>();
const accountListeners = new Set<() => void>();
const quotaListeners = new Set<() => void>();
const scopeListeners = new Set<() => void>();
let publicScope: string | null | undefined;
let publicFlight: Promise<void> | null = null;
let clientUserId: string | null | undefined;
let clientFlight: Promise<void> | null = null;
let accountFlight: Promise<void> | null = null;
let quotaFlight: Promise<void> | null = null;
let quotaFlightAccountId: string | null = null;

function createPublisher<T>(
    read: () => T,
    write: (value: T) => void,
    listeners: Set<() => void>,
) {
    return (patch: Partial<T>) => {
        write({ ...read(), ...patch });
        listeners.forEach((listener) => listener());
    };
}

const publishPortal = createPublisher(
    () => portalSnapshot,
    (value) => (portalSnapshot = value),
    portalListeners,
);
const publishAccount = createPublisher(
    () => accountSnapshot,
    (value) => (accountSnapshot = value),
    accountListeners,
);
const publishQuota = createPublisher(
    () => quotaSnapshot,
    (value) => (quotaSnapshot = value),
    quotaListeners,
);
const publishScope = createPublisher(
    () => scopeSnapshot,
    (value) => (scopeSnapshot = value),
    scopeListeners,
);

// The NAS devices the API reports for the customer's accounts. A scope that
// is not part of them is stale (the line was moved to another router) and
// must not be used.
function knownNasIds(clients: PppoeClient[]) {
    const ids = new Set<string>();
    for (const client of clients) {
        if (client.nasDeviceId) ids.add(client.nasDeviceId);
    }
    return ids;
}

// The network a signed-in customer belongs to: the first active account that
// is bound to a NAS. Suspended or closed lines are only used when no active
// one is left — they still identify the router serving the customer.
function initialNasClient(clients: PppoeClient[]) {
    return (
        clients.find(
            (client) => client.status === 'active' && client.nasDeviceId,
        ) ??
        clients.find((client) => client.nasDeviceId) ??
        null
    );
}

// Selects the network the whole portal is scoped to (packages, contacts,
// payments). Persisted so the scope survives reloads after the ?nas= URL
// parameter was cleaned up.
export function setNasScope(nasDeviceId: string | null) {
    if (scopeSnapshot.nasDeviceId === nasDeviceId) return;
    setNasDeviceId(nasDeviceId);
    publishScope({ nasDeviceId });
    // A network change invalidates the NAS-scoped account availability and
    // the quota of any account that does not belong to the new network.
    if (accountSnapshot.clients.length > 0) {
        const stillValid =
            nasDeviceId !== null &&
            accountSnapshot.clients.some(
                (client) =>
                    client.accountId === accountSnapshot.selectedAccountId &&
                    client.nasDeviceId === nasDeviceId,
            );
        if (!stillValid) {
            publishAccount({
                selectedAccountId:
                    accountSnapshot.clients.find(
                        (client) => client.nasDeviceId === nasDeviceId,
                    )?.accountId ?? accountSnapshot.selectedAccountId,
            });
        }
    }
}

export function useNasScope() {
    return useSyncExternalStore(
        (listener) => subscribe(scopeListeners, listener),
        () => scopeSnapshot,
    );
}

function subscribe(listeners: Set<() => void>, listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function loadPppoePortal(
    userId: string | null,
    nasDeviceId: string | null,
    force = false,
) {
    if (publicScope !== nasDeviceId || (force && !publicFlight)) {
        const scopeChanged = publicScope !== nasDeviceId;
        publicScope = nasDeviceId;
        publishPortal({
            ...(scopeChanged
                ? {
                      packages: undefined,
                      contacts: defaultAdminSettings.contacts,
                  }
                : {}),
            packagesLoading: scopeChanged || portalSnapshot.packages === undefined,
            packagesError: null,
            contactsError: null,
        });
        const flight = (async () => {
            try {
                const [contacts, packages] = await Promise.all([
                    getContacts(nasDeviceId),
                    getPackages(nasDeviceId),
                ]);
                if (publicScope !== nasDeviceId) return;
                // The scoped NAS does not exist (deleted by the admin, or an
                // id left behind in storage): drop it instead of showing an
                // empty portal. A signed-in customer falls back to the
                // network of their accounts, a visitor gets the sign-in card.
                if (
                    nasDeviceId !== null &&
                    !packages.success &&
                    packages.type === ApiErrorType.NOT_FOUND
                ) {
                    publishPortal({
                        packages: undefined,
                        packagesError: null,
                        packagesLoading: false,
                    });
                    setNasScope(null);
                    return;
                }
                publishPortal({
                    contacts:
                        contacts.success && contacts.data
                            ? contacts.data
                            : portalSnapshot.contacts,
                    contactsError: contacts.success ? null : contacts.message,
                    packages: packages.success
                        ? packages.data
                        : portalSnapshot.packages,
                    packagesError: packages.success ? null : packages.message,
                    packagesLoading: false,
                });
            } catch (error) {
                storeLogger.warning('Unexpected portal load failure.', {
                    operation: 'load-portal',
                    errorName:
                        error instanceof Error ? error.name : 'UnknownError',
                });
                if (publicScope === nasDeviceId) {
                    publishPortal({
                        packagesError:
                            'Could not load PPPoE packages. Try again.',
                        contactsError: 'Could not load support contacts.',
                    });
                }
            }
        })();
        publicFlight = flight;
        const finish = () => {
            if (publicFlight === flight) {
                publishPortal({ packagesLoading: false });
                publicFlight = null;
            }
        };
        void publicFlight.then(finish, finish);
    }

    if (clientUserId !== userId || (force && !clientFlight)) {
        const userChanged = clientUserId !== userId;
        clientUserId = userId;
        publishPortal({
            ...(userChanged ? { client: undefined } : {}),
            clientError: null,
        });
        if (!userId) {
            publishAccount({
                clients: [],
                selectedAccountId: null,
                config: null,
                loading: false,
                error: null,
            });
            publishQuota({ quota: [], loading: false, error: null });
        }
        clientFlight = userId
            ? getClientData()
                  .then((result) => {
                      if (clientUserId === userId) {
                          publishPortal(
                              result.success
                                  ? { client: result.data, clientError: null }
                                  : { clientError: result.message },
                          );
                      }
                  })
                  .catch((error: unknown) => {
                      storeLogger.warning('Unexpected client load failure.', {
                          operation: 'load-client',
                          errorName:
                              error instanceof Error
                                  ? error.name
                                  : 'UnknownError',
                      });
                      if (clientUserId === userId) {
                          publishPortal({
                              clientError:
                                  'Could not load your account. Try again.',
                          });
                      }
                  })
                  .finally(() => {
                      clientFlight = null;
                  })
            : null;
    }

    return Promise.all([publicFlight, clientFlight]);
}

export function refreshPppoeAccounts() {
    if (accountFlight) return accountFlight;
    const userId = clientUserId;
    if (!userId) return Promise.resolve();
    publishAccount({
        loading: accountSnapshot.clients.length === 0,
        error: null,
    });
    const configRequest = accountSnapshot.config ? null : getServiceConfig();
    const flight = Promise.all([getClients(), configRequest])
        .then(([clients, config]) => {
            if (clientUserId !== userId) return;
            if (config && !config.success) {
                storeLogger.warning('Could not load the PPPoE service config.', {
                    operation: 'load-service-config',
                    errorType: config.type,
                });
            }
            const nextClients = clients.success
                ? [...(clients.data ?? [])].sort(
                      (a, b) =>
                          Number(b.availableOnPortal) -
                              Number(a.availableOnPortal) ||
                          Number(b.status === 'active') -
                              Number(a.status === 'active') ||
                          Number(Boolean(b.activeActivation)) -
                              Number(Boolean(a.activeActivation)) ||
                          Number(b.online) - Number(a.online) ||
                          (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? ''),
                  )
                : accountSnapshot.clients;
            // The network the portal is scoped to. A scope the API does not
            // know about is stale — it was deleted or the line moved to
            // another router — so it is dropped in favour of the customer's
            // own network. Without a scope (external visit) the first active
            // account bound to a NAS defines the network, e.g. right after
            // signing in or claiming admin-provisioned credentials.
            const scope = scopeSnapshot.nasDeviceId;
            const apiNasIds = knownNasIds(nextClients);
            const scopeIsStale =
                scope !== null &&
                apiNasIds.size > 0 &&
                !apiNasIds.has(scope);
            const initial = initialNasClient(nextClients);
            const nextScope =
                scope === null || scopeIsStale
                    ? (initial?.nasDeviceId ?? null)
                    : scope;
            const scopeChanged = nextScope !== scope;
            if (scopeChanged) setNasScope(nextScope);
            // Prefer the account bound to the network this portal is scoped
            // to; the account switcher doubles as the network selector.
            const selectedAccountId = nextClients.some(
                (client) =>
                    client.accountId === accountSnapshot.selectedAccountId &&
                    (!scopeChanged || client.nasDeviceId === nextScope),
            )
                ? accountSnapshot.selectedAccountId
                : (nextClients.find((client) => client.nasDeviceId === nextScope)
                      ?.accountId ??
                  nextClients.find((client) => client.availableOnPortal)
                      ?.accountId ??
                  nextClients[0]?.accountId ??
                  null);
            if (selectedAccountId !== accountSnapshot.selectedAccountId) {
                publishQuota({
                    quota: [],
                    loading: Boolean(selectedAccountId),
                    error: null,
                });
            }
            publishAccount({
                clients: nextClients,
                selectedAccountId,
                config:
                    config?.success && config.data
                        ? config.data
                        : accountSnapshot.config,
                loading: false,
                error: clients.success ? null : clients.message,
            });
        })
        .catch((error: unknown) => {
            storeLogger.warning('Unexpected account refresh failure.', {
                operation: 'load-accounts',
                errorName:
                    error instanceof Error ? error.name : 'UnknownError',
            });
            if (clientUserId === userId) {
                publishAccount({
                    error: 'Could not load your PPPoE accounts. Try again.',
                });
            }
        })
        .finally(() => {
            if (accountFlight === flight) {
                publishAccount({ loading: false });
                accountFlight = null;
            }
        });
    accountFlight = flight;
    return accountFlight;
}

export function refreshPppoeQuota(
    accountId = accountSnapshot.selectedAccountId,
) {
    if (!accountId) {
        publishQuota({ quota: [], loading: false, error: null });
        return Promise.resolve();
    }
    if (quotaFlight && quotaFlightAccountId === accountId) return quotaFlight;
    quotaFlightAccountId = accountId;
    const flight = getStatus(accountId)
        .then((result) => {
            if (accountSnapshot.selectedAccountId !== accountId) return;
            if (result.success) {
                publishQuota({
                    quota: result.data ?? [],
                    error: null,
                    loading: false,
                });
            } else {
                publishQuota({ error: result.message, loading: false });
            }
        })
        .catch((error: unknown) => {
            storeLogger.warning('Unexpected quota load failure.', {
                operation: 'load-quota',
                errorName: error instanceof Error ? error.name : 'UnknownError',
            });
            if (accountSnapshot.selectedAccountId === accountId) {
                publishQuota({
                    error: 'Could not load your active package. Try again.',
                    loading: false,
                });
            }
        })
        .finally(() => {
            if (quotaFlightAccountId === accountId) {
                quotaFlight = null;
                quotaFlightAccountId = null;
            }
        });
    quotaFlight = flight;
    return quotaFlight;
}

// Selecting an account also selects its network: every PPPoE account is
// bound to one NAS device, and packages/payments follow that scope.
export function selectPppoeAccount(accountId: string) {
    const client = accountSnapshot.clients.find(
        (value) => value.accountId === accountId,
    );
    if (!client) return;
    if (accountId !== accountSnapshot.selectedAccountId) {
        publishAccount({ selectedAccountId: accountId });
        publishQuota({ quota: [], loading: true, error: null });
    }
    if (client.nasDeviceId && client.nasDeviceId !== scopeSnapshot.nasDeviceId) {
        setNasScope(client.nasDeviceId);
    }
}

export function usePppoePortal() {
    return useSyncExternalStore(
        (listener) => subscribe(portalListeners, listener),
        () => portalSnapshot,
    );
}

export function usePppoeAccounts() {
    return useSyncExternalStore(
        (listener) => subscribe(accountListeners, listener),
        () => accountSnapshot,
    );
}

export function usePppoeQuota(
    accountId: string | null,
    enabled = true,
) {
    const snapshot = useSyncExternalStore(
        (listener) => subscribe(quotaListeners, listener),
        () => quotaSnapshot,
    );

    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        let timer: number | undefined;
        const poll = async () => {
            await refreshPppoeQuota(accountId);
            if (!cancelled) timer = window.setTimeout(poll, 5_000);
        };
        void poll();
        return () => {
            cancelled = true;
            if (timer !== undefined) window.clearTimeout(timer);
        };
    }, [accountId, enabled]);

    return snapshot;
}
