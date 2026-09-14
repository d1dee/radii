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

type PortalSnapshot = {
    client: Client | undefined;
    packages: Packages | undefined;
    contacts: AdminContactsSettings;
};

type QuotaSnapshot = {
    quota: Quota[];
    loading: boolean;
};

let portalSnapshot: PortalSnapshot = {
    client: undefined,
    packages: undefined,
    contacts: defaultAdminSettings.contacts,
};
let quotaSnapshot: QuotaSnapshot = { quota: [], loading: true };

const portalListeners = new Set<() => void>();
const quotaListeners = new Set<() => void>();
let publicScope: string | null | undefined;
let publicFlight: Promise<void> | null = null;
let clientUserId: string | null | undefined;
let clientFlight: Promise<void> | null = null;
let quotaFlight: Promise<void> | null = null;

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
) {
    if (publicScope !== loginRequestId) {
        publicScope = loginRequestId;
        publicFlight = (async () => {
            const [contacts, packages] = await Promise.all([
                getContacts(loginRequestId),
                loginRequestId ? getPackages(loginRequestId) : null,
            ]);
            if (publicScope !== loginRequestId) return;
            publishPortal({
                contacts:
                    contacts.success && contacts.data
                        ? contacts.data
                        : defaultAdminSettings.contacts,
                packages: packages?.success ? packages.data : undefined,
            });
        })().finally(() => {
            publicFlight = null;
        });
    }

    if (clientUserId !== userId) {
        clientUserId = userId;
        publishPortal({ client: undefined });
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

export function refreshHotspotQuota(loginRequestId: string | null) {
    if (quotaFlight) return quotaFlight;
    publishQuota({ loading: quotaSnapshot.quota.length === 0 });
    quotaFlight = getStatus(loginRequestId)
        .then((result) => {
            if (result.success) publishQuota({ quota: result.data ?? [] });
        })
        .finally(() => {
            publishQuota({ loading: false });
            quotaFlight = null;
        });
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
