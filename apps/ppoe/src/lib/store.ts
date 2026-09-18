import type {
    AdminContactsSettings,
    Packages,
    PppoeClient,
    PppoeServiceConfig,
    Quota,
} from '@radii/shared';
import { defaultAdminSettings } from '@radii/shared';
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

type PortalSnapshot = {
    client: Client | undefined;
    packages: Packages | undefined;
    contacts: AdminContactsSettings;
};

type AccountSnapshot = {
    clients: PppoeClient[];
    selectedAccountId: string | null;
    config: PppoeServiceConfig | null;
    loading: boolean;
};

type QuotaSnapshot = { quota: Quota[]; loading: boolean };

type ScopeSnapshot = { nasDeviceId: string | null };

let portalSnapshot: PortalSnapshot = {
    client: undefined,
    packages: undefined,
    contacts: defaultAdminSettings.contacts,
};
let scopeSnapshot: ScopeSnapshot = {
    nasDeviceId: currentNasDeviceId(),
};
let accountSnapshot: AccountSnapshot = {
    clients: [],
    selectedAccountId: null,
    config: null,
    loading: true,
};
let quotaSnapshot: QuotaSnapshot = { quota: [], loading: true };

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

export function loadPppoePortal(userId: string | null, nasDeviceId: string | null) {
    if (publicScope !== nasDeviceId) {
        publicScope = nasDeviceId;
        publicFlight = Promise.all([
            getContacts(nasDeviceId),
            getPackages(nasDeviceId),
        ])
            .then(([contacts, packages]) => {
                if (publicScope !== nasDeviceId) return;
                publishPortal({
                    contacts:
                        contacts.success && contacts.data
                            ? contacts.data
                            : defaultAdminSettings.contacts,
                    packages: packages.success ? packages.data : undefined,
                });
            })
            .finally(() => {
                publicFlight = null;
            });
    }

    if (clientUserId !== userId) {
        clientUserId = userId;
        publishPortal({ client: undefined });
        if (!userId) {
            publishAccount({
                clients: [],
                selectedAccountId: null,
                config: null,
                loading: false,
            });
            publishQuota({ quota: [], loading: false });
        }
        clientFlight = userId
            ? getClientData()
                  .then((result) => {
                      if (clientUserId === userId && result.success) {
                          publishPortal({ client: result.data });
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
    publishAccount({ loading: accountSnapshot.clients.length === 0 });
    const configRequest = accountSnapshot.config ? null : getServiceConfig();
    accountFlight = Promise.all([getClients(), configRequest])
        .then(([clients, config]) => {
            if (clientUserId !== userId) return;
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
            // Prefer the account bound to the network this portal is scoped
            // to; the account switcher doubles as the network selector.
            const scope = scopeSnapshot.nasDeviceId;
            const selectedAccountId = nextClients.some(
                (client) => client.accountId === accountSnapshot.selectedAccountId,
            )
                ? accountSnapshot.selectedAccountId
                : (nextClients.find((client) => client.nasDeviceId === scope)
                      ?.accountId ??
                  nextClients.find((client) => client.availableOnPortal)
                      ?.accountId ??
                  nextClients[0]?.accountId ??
                  null);
            // The portal has no network scope (external visit): adopt the
            // network of the account the customer will manage by default —
            // e.g. right after claiming admin-provisioned credentials.
            if (scope === null && selectedAccountId) {
                const selectedClient = nextClients.find(
                    (client) => client.accountId === selectedAccountId,
                );
                if (selectedClient?.nasDeviceId) {
                    setNasScope(selectedClient.nasDeviceId);
                }
            }
            if (selectedAccountId !== accountSnapshot.selectedAccountId) {
                publishQuota({ quota: [], loading: Boolean(selectedAccountId) });
            }
            publishAccount({
                clients: nextClients,
                selectedAccountId,
                config:
                    config?.success && config.data
                        ? config.data
                        : accountSnapshot.config,
                loading: false,
            });
        })
        .finally(() => {
            publishAccount({ loading: false });
            accountFlight = null;
        });
    return accountFlight;
}

export function refreshPppoeQuota(
    accountId = accountSnapshot.selectedAccountId,
) {
    if (!accountId) {
        publishQuota({ quota: [], loading: false });
        return Promise.resolve();
    }
    if (quotaFlight && quotaFlightAccountId === accountId) return quotaFlight;
    quotaFlightAccountId = accountId;
    publishQuota({ loading: quotaSnapshot.quota.length === 0 });
    quotaFlight = getStatus(accountId)
        .then((result) => {
            if (
                result.success &&
                accountSnapshot.selectedAccountId === accountId
            ) {
                publishQuota({ quota: result.data ?? [] });
            }
        })
        .finally(() => {
            if (accountSnapshot.selectedAccountId === accountId) {
                publishQuota({ loading: false });
            }
            if (quotaFlightAccountId === accountId) {
                quotaFlight = null;
                quotaFlightAccountId = null;
            }
        });
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
        publishQuota({ quota: [], loading: true });
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
