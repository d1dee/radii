import type { AdminContactsSettings, Packages, Quota } from '@radii/shared';
import { defaultAdminSettings } from '@radii/shared';
import { useEffect, useSyncExternalStore } from 'react';
import {
    getClientData,
    getContacts,
    getPackages,
    getStatus,
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

type QuotaSnapshot = {
    quota: Quota[];
    loading: boolean;
    error: string | null;
};

let portalSnapshot: PortalSnapshot = {
    client: undefined,
    clientError: null,
    packages: undefined,
    packagesError: null,
    packagesLoading: true,
    contacts: defaultAdminSettings.contacts,
    contactsError: null,
};
let quotaSnapshot: QuotaSnapshot = { quota: [], loading: true, error: null };

const portalListeners = new Set<() => void>();
const quotaListeners = new Set<() => void>();
let publicScope: string | null | undefined;
let publicFlight: Promise<void> | null = null;
let clientUserId: string | null | undefined;
let clientFlight: Promise<void> | null = null;
let quotaFlight: Promise<void> | null = null;
let quotaScope: string | null | undefined;

function publishPortal(patch: Partial<PortalSnapshot>) {
    portalSnapshot = { ...portalSnapshot, ...patch };
    portalListeners.forEach((listener) => listener());
}

function publishQuota(patch: Partial<QuotaSnapshot>) {
    quotaSnapshot = { ...quotaSnapshot, ...patch };
    quotaListeners.forEach((listener) => listener());
}

function subscribePortal(listener: () => void) {
    portalListeners.add(listener);
    return () => {
        portalListeners.delete(listener);
    };
}

function subscribeQuota(listener: () => void) {
    quotaListeners.add(listener);
    return () => {
        quotaListeners.delete(listener);
    };
}

export function loadHotspotPortal(
    userId: string | null,
    loginRequestId: string | null,
    force = false,
) {
    if (publicScope !== loginRequestId || (force && !publicFlight)) {
        const scopeChanged = publicScope !== loginRequestId;
        publicScope = loginRequestId;
        publishPortal({
            ...(scopeChanged
                ? {
                      packages: undefined,
                      contacts: defaultAdminSettings.contacts,
                  }
                : {}),
            packagesLoading: true,
            packagesError: null,
            contactsError: null,
        });
        const flight = (async () => {
            try {
                const [contacts, packages] = await Promise.all([
                    getContacts(loginRequestId),
                    loginRequestId ? getPackages(loginRequestId) : null,
                ]);
                if (publicScope !== loginRequestId) return;
                publishPortal({
                    contacts:
                        contacts.success && contacts.data
                            ? contacts.data
                            : portalSnapshot.contacts,
                    contactsError: contacts.success ? null : contacts.message,
                    packages: packages?.success
                        ? (packages.data ?? [])
                        : portalSnapshot.packages,
                    packagesError:
                        packages && !packages.success ? packages.message : null,
                    packagesLoading: false,
                });
            } catch (error) {
                storeLogger.warning('Unexpected portal load failure.', {
                    operation: 'load-portal',
                    errorName:
                        error instanceof Error ? error.name : 'UnknownError',
                });
                if (publicScope === loginRequestId) {
                    publishPortal({
                        packagesError: 'Could not load hotspot packages. Try again.',
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
        clientUserId = userId;
        publishPortal({ client: undefined, clientError: null });
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

export function refreshHotspotQuota(loginRequestId: string | null) {
    if (quotaFlight && quotaScope === loginRequestId) return quotaFlight;
    if (quotaScope !== loginRequestId) {
        quotaScope = loginRequestId;
        publishQuota({ quota: [], error: null, loading: true });
    }
    publishQuota({ loading: quotaSnapshot.quota.length === 0 });
    const flight = getStatus(loginRequestId)
        .then((result) => {
            if (quotaScope !== loginRequestId) return;
            if (result.success) {
                publishQuota({ quota: result.data ?? [], error: null });
            } else {
                publishQuota({ error: result.message });
            }
        })
        .catch((error: unknown) => {
            storeLogger.warning('Unexpected quota load failure.', {
                operation: 'load-quota',
                errorName: error instanceof Error ? error.name : 'UnknownError',
            });
            if (quotaScope === loginRequestId) {
                publishQuota({
                    error: 'Could not load your active package. Try again.',
                });
            }
        })
        .finally(() => {
            if (quotaFlight === flight) {
                publishQuota({ loading: false });
                quotaFlight = null;
            }
        });
    quotaFlight = flight;
    return quotaFlight;
}

export function useHotspotPortal() {
    return useSyncExternalStore(subscribePortal, () => portalSnapshot);
}

export function useHotspotQuota(
    loginRequestId: string | null,
    enabled = true,
) {
    const snapshot = useSyncExternalStore(subscribeQuota, () => quotaSnapshot);

    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        let timer: number | undefined;

        const poll = async () => {
            await refreshHotspotQuota(loginRequestId);
            if (!cancelled) timer = window.setTimeout(poll, 5_000);
        };
        void poll();

        return () => {
            cancelled = true;
            if (timer !== undefined) window.clearTimeout(timer);
        };
    }, [enabled, loginRequestId]);

    return snapshot;
}
