import type { AdminContactsSettings, Packages, Quota } from '@radii/shared';
import { defaultAdminSettings } from '@radii/shared';
import { useEffect, useSyncExternalStore } from 'react';
import {
    getClientData,
    getContacts,
    getPackages,
    getStatus,
    LOGIN_REQUEST_KEY,
    type Client,
} from './api.ts';
import { storeLogger } from './logging.ts';

const UNKNOWN_LOGIN_REQUEST = 'Unknown login request';
const UNKNOWN_LOGIN_REQUEST_CACHE_KEY = 'radii.unknownLoginRequestId';

function currentLoginRequestId() {
    return (
        new URLSearchParams(window.location.search).get('login_request') ??
        localStorage.getItem(LOGIN_REQUEST_KEY)
    );
}

function isCachedUnknownLoginRequest(loginRequestId: string | null) {
    try {
        return (
            Boolean(loginRequestId) &&
            sessionStorage.getItem(UNKNOWN_LOGIN_REQUEST_CACHE_KEY) ===
                loginRequestId
        );
    } catch {
        return false;
    }
}

function cacheUnknownLoginRequest(loginRequestId: string | null, unknown: boolean) {
    try {
        if (unknown && loginRequestId) {
            sessionStorage.setItem(
                UNKNOWN_LOGIN_REQUEST_CACHE_KEY,
                loginRequestId,
            );
        } else if (
            !loginRequestId ||
            sessionStorage.getItem(UNKNOWN_LOGIN_REQUEST_CACHE_KEY) ===
                loginRequestId
        ) {
            sessionStorage.removeItem(UNKNOWN_LOGIN_REQUEST_CACHE_KEY);
        }
    } catch {
        // Storage can be unavailable in restricted captive-portal browsers.
    }
}

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

const initialUnknownLoginRequest = isCachedUnknownLoginRequest(
    currentLoginRequestId(),
);

let portalSnapshot: PortalSnapshot = {
    client: undefined,
    clientError: null,
    packages: undefined,
    packagesError: initialUnknownLoginRequest ? UNKNOWN_LOGIN_REQUEST : null,
    packagesLoading: !initialUnknownLoginRequest,
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
        const cachedUnknown = isCachedUnknownLoginRequest(loginRequestId);
        publicScope = loginRequestId;
        publishPortal({
            ...(scopeChanged
                ? {
                      packages: undefined,
                      contacts: defaultAdminSettings.contacts,
                  }
                : {}),
            packagesLoading:
                !cachedUnknown &&
                (scopeChanged || portalSnapshot.packages === undefined),
            packagesError: cachedUnknown ? UNKNOWN_LOGIN_REQUEST : null,
            contactsError: null,
        });
        const flight = (async () => {
            try {
                const [contacts, packages] = await Promise.all([
                    getContacts(loginRequestId),
                    loginRequestId ? getPackages(loginRequestId) : null,
                ]);
                if (publicScope !== loginRequestId) return;
                if (packages?.success) {
                    cacheUnknownLoginRequest(loginRequestId, false);
                } else if (packages?.message === UNKNOWN_LOGIN_REQUEST) {
                    cacheUnknownLoginRequest(loginRequestId, true);
                }
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
        const userChanged = clientUserId !== userId;
        clientUserId = userId;
        publishPortal({
            ...(userChanged ? { client: undefined } : {}),
            clientError: null,
        });
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
    const flight = getStatus(loginRequestId)
        .then((result) => {
            if (quotaScope !== loginRequestId) return;
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
            if (quotaScope === loginRequestId) {
                publishQuota({
                    error: 'Could not load your active package. Try again.',
                    loading: false,
                });
            }
        })
        .finally(() => {
            if (quotaFlight === flight) {
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
