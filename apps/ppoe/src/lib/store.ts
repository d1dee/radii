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
    getClientData,
    getClients,
    getContacts,
    getPackages,
    getServiceConfig,
    getStatus,
    type Client,
} from './api.ts';

type PortalSnapshot = {
    client: Client | undefined;
    packages: Packages | undefined;
    contacts: AdminContactsSettings;
};

type AccountSnapshot = {
    clients: PppoeClient[];
    config: PppoeServiceConfig | null;
    loading: boolean;
};

type QuotaSnapshot = { quota: Quota[]; loading: boolean };

let portalSnapshot: PortalSnapshot = {
    client: undefined,
    packages: undefined,
    contacts: defaultAdminSettings.contacts,
};
let accountSnapshot: AccountSnapshot = {
    clients: [],
    config: null,
    loading: true,
};
let quotaSnapshot: QuotaSnapshot = { quota: [], loading: true };

const portalListeners = new Set<() => void>();
const accountListeners = new Set<() => void>();
const quotaListeners = new Set<() => void>();
let publicScope: string | null | undefined;
let publicFlight: Promise<void> | null = null;
let clientUserId: string | null | undefined;
let clientFlight: Promise<void> | null = null;
let accountFlight: Promise<void> | null = null;
let quotaFlight: Promise<void> | null = null;

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
        if (!userId) publishAccount({ clients: [], config: null, loading: false });
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
            publishAccount({
                clients: clients.success ? (clients.data ?? []) : accountSnapshot.clients,
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

export function refreshPppoeQuota() {
    if (quotaFlight) return quotaFlight;
    publishQuota({ loading: quotaSnapshot.quota.length === 0 });
    quotaFlight = getStatus()
        .then((result) => {
            if (result.success) publishQuota({ quota: result.data ?? [] });
        })
        .finally(() => {
            publishQuota({ loading: false });
            quotaFlight = null;
        });
    return quotaFlight;
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

export function usePppoeQuota(enabled = true) {
    const snapshot = useSyncExternalStore(
        (listener) => subscribe(quotaListeners, listener),
        () => quotaSnapshot,
    );

    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        let timer: number | undefined;
        const poll = async () => {
            await refreshPppoeQuota();
            if (!cancelled) timer = window.setTimeout(poll, 5_000);
        };
        void poll();
        return () => {
            cancelled = true;
            if (timer !== undefined) window.clearTimeout(timer);
        };
    }, [enabled]);

    return snapshot;
}
