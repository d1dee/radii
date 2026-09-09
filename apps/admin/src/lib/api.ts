import {
    ApiErrorType,
    type AdminSettings,
    type AdminSettingsInput,
    type ApiEnvelope,
    type GenerateSetupScriptInput,
    type NasDeviceOs,
    type NasDeviceStatus,
} from '@shared/index';

export type {
    AdminSettings,
    GenerateSetupScriptInput,
    NasDeviceOs,
    NasDeviceStatus,
} from '@shared/index';

const BASE = import.meta.env.VITE_API_URL + '/api';

export async function request<T>(
    path: string,
    body?: unknown,
    opts?: RequestInit,
): Promise<ApiEnvelope<T>> {
    let res: Response;
    try {
        res = await fetch(`${BASE}${path}`, {
            method: 'GET',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            ...(body !== undefined && opts?.method !== 'GET'
                ? { body: JSON.stringify(body) }
                : {}),
            ...opts,
        });
    } catch {
        return {
            success: false,
            message: 'Could not reach the server. Try again.',
            type: ApiErrorType.NETWORK_ERROR,
        };
    }

    let json: ApiEnvelope<T>;
    try {
        json = (await res.json()) as ApiEnvelope<T>;
    } catch {
        return {
            success: false,
            message: `Request to ${path} failed (${res.status})`,
            type: ApiErrorType.NETWORK_ERROR,
        };
    }

    if (!json.success)
        return {
            success: false,
            message: json.message,
            type: json.type,
            data: json.data,
        };
    return json;
}

export function register(body: {
    phoneNumber: string;
    pin: string;
    verifyPin: string;
}) {
    return request('/hotspot/register', body, { method: 'POST' });
}

export function login(body: { phoneNumber: string; pin: string }) {
    return request('/hotspot/login', body, { method: 'POST' });
}

export type PackageType = 'hotspot' | 'pppoe';

// Raw package row as returned by the admin endpoints.
export type PackageRow = {
    id: string;
    title: string;
    type: PackageType;
    category: string;
    sessionLength: number;
    // Static validity of an activation in days (bank packages consume their
    // cumulative time within this window).
    validityDays?: number;
    price: string;
    maxDevices: number;
    noExpiry: boolean;
    description: string | null;
    note: string | null;
    uploadRate: number;
    downloadRate: number;
    downloadQuota: number;
    uploadQuota: number;
    // NAS devices the package is restricted to; empty means all devices.
    nasDeviceIds: string[];
    isActive: boolean;
    createdAt: string;
};

export type CreatePackageInput = {
    title: string;
    type: PackageType;
    category: string;
    sessionLength: number;
    validityDays?: number;
    price: number;
    maxDevices: number;
    noExpiry: boolean;
    description?: string;
    note?: string;
    uploadRate: number;
    downloadRate: number;
    downloadQuota: number;
    uploadQuota: number;
    // NAS devices the package is available on; at least one is required.
    nasDeviceIds: string[];
};

export function getAdminPackages(type?: PackageType) {
    return request<PackageRow[]>(
        type ? `/admin/packages?type=${type}` : '/admin/packages',
    );
}

export function getAdminPackage(id: string) {
    return request<PackageRow>(`/admin/packages/${id}`);
}

export type PackagePaymentStatus = 'pending' | 'paid' | 'failed';

export type PackageAnalytics = {
    payments: {
        total: number;
        pending: number;
        paid: number;
        failed: number;
        revenue: number;
    };
    buyers: {
        unique: number;
        repeat: number;
    };
    activations: {
        total: number;
        active: number;
    };
    recentPayments: Array<{
        id: string;
        phoneNumber: string;
        amount: string;
        status: PackagePaymentStatus;
        createdAt: string;
    }>;
};

export function getPackageAnalytics(id: string) {
    return request<PackageAnalytics>(`/admin/packages/${id}/analytics`);
}

export function createPackage(body: CreatePackageInput) {
    return request<PackageRow>('/admin/packages', body, { method: 'POST' });
}

export function updateAdminPackage(id: string, body: CreatePackageInput) {
    return request<PackageRow>(`/admin/packages/${id}`, body, {
        method: 'PUT',
    });
}

// Raw NAS device row as returned by the admin endpoints.
export type NasDeviceRow = {
    id: string;
    name: string;
    ipAddress: string;
    macAddress: string | null;
    model: string | null;
    serialNumber: string | null;
    firmwareVersion: string | null;
    location: string | null;
    ownerId: string;
    status: NasDeviceStatus;
    metadata: Record<string, unknown> | null;
    createdAt: string;
    updatedAt: string;
};

export type CreateNasDeviceInput = {
    name: string;
    os: NasDeviceOs;
    ipAddress: string;
    macAddress: string;
    model: string;
    serialNumber: string;
    firmwareVersion: string;
    location: string;
    status: NasDeviceStatus;
};

export function getNasDevices() {
    return request<NasDeviceRow[]>('/admin/nas-devices');
}

export function getNasDevice(id: string) {
    return request<NasDeviceRow>(`/admin/nas-devices/${id}`);
}

export function createNasDevice(body: CreateNasDeviceInput) {
    return request<NasDeviceRow>('/admin/nas-devices', body, {
        method: 'POST',
    });
}

export function updateNasDevice(id: string, body: CreateNasDeviceInput) {
    return request<NasDeviceRow>(`/admin/nas-devices/${id}`, body, {
        method: 'PUT',
    });
}

export type NasDeviceAnalytics = {
    packages: {
        total: number;
        active: number;
    };
    payments: {
        total: number;
        pending: number;
        paid: number;
        failed: number;
        revenue: number;
    };
    buyers: {
        unique: number;
        repeat: number;
    };
    activations: {
        total: number;
        active: number;
    };
    sessions: {
        total: number;
        active: number;
    };
    recentPayments: Array<{
        id: string;
        phoneNumber: string;
        amount: string;
        status: PackagePaymentStatus;
        packageTitle: string;
        createdAt: string;
    }>;
};

export function getNasDeviceAnalytics(id: string) {
    return request<NasDeviceAnalytics>(`/admin/nas-devices/${id}/analytics`);
}

// --- Users (hotspot + PPPoE management) ------------------------------------

export type AdminUserRow = {
    id: string;
    name: string;
    email: string;
    phoneNumber: string;
    image: string | null;
    role: string | null;
    banned: boolean;
    banReason: string | null;
    createdAt: string;
    flags: number;
    online: boolean;
    payments: {
        total: number;
        paid: number;
        pending: number;
        failed: number;
        revenue: number;
    };
    activations: {
        total: number;
        active: number;
        hotspot: number;
        pppoe: number;
    };
    lastPaymentAt: string | null;
};

export type AdminUserList = {
    total: number;
    page: number;
    perPage: number;
    users: AdminUserRow[];
};

export type AdminUserFlagRow = {
    id: string;
    reason: string;
    note: string | null;
    createdAt: string;
    createdBy: string | null;
    creatorName: string | null;
};

export type AdminUserDetail = {
    id: string;
    name: string;
    email: string;
    phoneNumber: string;
    image: string | null;
    role: string | null;
    banned: boolean;
    banReason: string | null;
    createdAt: string;
    flags: AdminUserFlagRow[];
    payments: {
        total: number;
        paid: number;
        pending: number;
        failed: number;
        revenue: number;
        firstAt: string | null;
        lastAt: string | null;
    };
    activations: {
        total: number;
        active: number;
        hotspot: number;
        pppoe: number;
    };
    usage: {
        sessions: number;
        seconds: number;
        octets: number;
        lastSeen: string | null;
    };
    online: boolean;
    pppoe: { username: string; password: string | null } | null;
};

export type ListAdminUsersQuery = {
    q?: string;
    type?: PackageType;
    flagged?: boolean;
    page?: number;
    perPage?: number;
};

export function getAdminUsers(query: ListAdminUsersQuery = {}) {
    const params = new URLSearchParams();
    if (query.q) params.set('q', query.q);
    if (query.type) params.set('type', query.type);
    if (query.flagged) params.set('flagged', '1');
    if (query.page) params.set('page', String(query.page));
    if (query.perPage) params.set('perPage', String(query.perPage));
    const qs = params.toString();
    return request<AdminUserList>(`/admin/users${qs ? `?${qs}` : ''}`);
}

export function getAdminUser(id: string) {
    return request<AdminUserDetail>(`/admin/users/${id}`);
}

export function addUserFlag(
    id: string,
    body: { reason: string; note?: string },
) {
    return request<AdminUserFlagRow>(`/admin/users/${id}/flags`, body, {
        method: 'POST',
    });
}

export function removeUserFlag(id: string, flagId: string) {
    return request<{ message?: string }>(`/admin/users/${id}/flags/${flagId}`, undefined, {
        method: 'DELETE',
    });
}

export function banUser(
    id: string,
    body: { reason?: string; expiresAt?: string | null } = {},
) {
    return request<{ message?: string }>(`/admin/users/${id}/ban`, body, {
        method: 'POST',
    });
}

export function unbanUser(id: string) {
    return request<{ message?: string }>(`/admin/users/${id}/ban`, undefined, {
        method: 'DELETE',
    });
}

// --- User payments / activations / PPPoE credentials -------------------------

export type AdminPaymentRow = {
    id: string;
    userId: string;
    userName: string | null;
    phoneNumber: string;
    amount: string;
    status: PackagePaymentStatus;
    packageTitle: string | null;
    packageType: PackageType | null;
    provider: string | null;
    providerTransactionId: string | null;
    providerReference: string | null;
    createdAt: string;
    updatedAt: string;
};

export type AdminPaymentList = {
    total: number;
    summary: {
        paid: number;
        pending: number;
        failed: number;
        revenue: number;
    };
    page: number;
    perPage: number;
    payments: AdminPaymentRow[];
};

export type UserPaymentRow = {
    id: string;
    amount: string;
    status: PackagePaymentStatus;
    phoneNumber: string;
    packageTitle: string;
    packageType: PackageType;
    provider: string | null;
    providerTransactionId: string | null;
    createdAt: string;
    updatedAt: string;
};

export function getUserPayments(id: string) {
    return request<UserPaymentRow[]>(`/admin/users/${id}/payments`);
}

// Mirrors the API's ActivationStatus (apps/api/src/lib/radius/client.ts).
export type AdminActivationRow = {
    activationId: string;
    userId: string;
    username: string;
    packageId: string;
    packageTitle: string;
    packageType: PackageType;
    paymentId: string;
    activatedAt: string;
    expireAt: string;
    expired: boolean;
    noExpiry: boolean;
    maxDevices: number;
    sessionLimitSeconds: number;
    usedSeconds: number;
    remainingSeconds: number | null;
    octetsUsed: number;
    octetsLimit: number | null;
    remainingOctets: number | null;
    online: boolean;
    liveSessions: SessionInfo[];
    avgSpeedBps: number;
    lastActive: string | null;
};

export type SessionInfo = {
    radacctId: string;
    acctSessionId: string;
    username: string;
    nasIpAddress: string;
    callingStationId: string | null;
    framedIpAddress: string | null;
    startedAt: string | null;
    updatedAt: string | null;
    stoppedAt: string | null;
    live: boolean;
    seconds: number;
    inputOctets: number;
    outputOctets: number;
    totalOctets: number;
    terminateCause: string | null;
    avgSpeedBps: number;
};

export type AdminSessionRow = SessionInfo;

export function getUserActivations(id: string) {
    return request<AdminActivationRow[]>(`/admin/users/${id}/activations`);
}

export function setPppoePassword(id: string, password?: string) {
    return request<{
        username: string;
        password: string;
        sessionsDisconnected: number;
    }>(`/admin/users/${id}/pppoe-password`, { password }, { method: 'POST' });
}

// --- Payment log ---------------------------------------------------------------

export type ListPaymentsQuery = {
    status?: PackagePaymentStatus;
    q?: string;
    from?: string;
    to?: string;
    page?: number;
    perPage?: number;
};

export function getAdminPayments(query: ListPaymentsQuery = {}) {
    const params = new URLSearchParams();
    if (query.status) params.set('status', query.status);
    if (query.q) params.set('q', query.q);
    if (query.from) params.set('from', query.from);
    if (query.to) params.set('to', query.to);
    if (query.page) params.set('page', String(query.page));
    if (query.perPage) params.set('perPage', String(query.perPage));
    const qs = params.toString();
    return request<AdminPaymentList>(`/admin/payments${qs ? `?${qs}` : ''}`);
}

// --- Reports ---------------------------------------------------------------------

export type AdminReports = {
    totals: {
        payments: number;
        revenue: number;
        buyers: number;
        newUsers: number;
        newActivations: number;
    };
    daily: Array<{
        day: string;
        paid: number;
        pending: number;
        failed: number;
        revenue: number;
    }>;
    topPackages: Array<{
        packageId: string;
        title: string;
        type: PackageType;
        paid: number;
        revenue: number;
    }>;
    topUsers: Array<{
        userId: string;
        userName: string;
        phoneNumber: string;
        paid: number;
        revenue: number;
    }>;
    topUsage: Array<{
        username: string;
        sessions: number;
        seconds: number;
        octets: number;
    }>;
};

export function getAdminReports(from: string, to: string) {
    const params = new URLSearchParams({ from, to });
    return request<AdminReports>(`/admin/reports?${params.toString()}`);
}

// --- Activation & session management -------------------------------------------

export function activateActivation(id: string) {
    return request<{
        ok: boolean;
        message: string;
        expireAt: string | null;
    }>(`/admin/activations/${id}/activate`, undefined, { method: 'POST' });
}

export function deactivateActivation(id: string) {
    return request<{
        ok: boolean;
        message: string;
        sessionsFound: number;
        sessionsDisconnected: number;
    }>(`/admin/radius/activations/${id}/deactivate`, undefined, {
        method: 'POST',
    });
}

export function updateActivation(id: string, body: { expireAt: string }) {
    return request<{ ok: boolean; message: string }>(
        `/admin/activations/${id}`,
        body,
        { method: 'PUT' },
    );
}

export function getRadiusSessions(limit = 100) {
    return request<SessionInfo[]>(`/admin/radius/sessions?limit=${limit}`);
}

// Mirrors the API's NetworkUsage (apps/api/src/lib/radius/client.ts).
export type NetworkUsage = {
    windowMinutes: number;
    liveSessions: number;
    liveUsers: number;
    liveOctets: number;
    aggregateThroughputBps: number;
    avgSpeedPerSessionBps: number;
    sessionsStartedInWindow: number;
    avgSessionSeconds: number;
    topUsers: Array<{ username: string; octets: number; sessions: number }>;
};

export function getRadiusSummary(windowMinutes = 60) {
    return request<NetworkUsage>(
        `/admin/radius/summary?windowMinutes=${windowMinutes}`,
    );
}

export function disconnectSession(radacctId: string) {
    return request<{ ok: boolean; message: string }>(
        `/admin/radius/sessions/${radacctId}/disconnect`,
        undefined,
        { method: 'POST' },
    );
}

export function editSessionTimeout(radacctId: string, sessionTimeout: number) {
    return request<{ ok: boolean; message: string }>(
        `/admin/radius/sessions/${radacctId}`,
        { sessionTimeout },
        { method: 'PUT' },
    );
}

export type NasSetupScriptStatus = 'pending' | 'applied' | 'failed';

// Generated RouterOS setup script stored on the server.
export type NasSetupScriptRow = {
    id: string;
    nasDeviceId: string;
    script: string;
    wgPublicKey: string | null;
    wgClientIp: string;
    // Hotspot options used when the script was generated; null for rows
    // generated before the options were persisted.
    hotspotInterface: string | null;
    hotspotNetwork: string | null;
    hotspotDnsName: string | null;
    brandName: string | null;
    // PPPoE options used when the script was generated; null for rows
    // generated before the options were persisted.
    pppoeInterface: string | null;
    pppoeNetwork: string | null;
    wgKeyReportedAt: string | null;
    status: NasSetupScriptStatus;
    generatedAt: string;
    createdAt: string;
    updatedAt: string;
};

export function getNasSetupScript(deviceId: string) {
    return request<NasSetupScriptRow>(
        `/admin/nas-devices/${deviceId}/setup-script`,
    );
}

export function generateNasSetupScript(
    deviceId: string,
    input?: GenerateSetupScriptInput,
) {
    return request<NasSetupScriptRow>(
        `/admin/nas-devices/${deviceId}/setup-script`,
        input ?? {},
        { method: 'POST' },
    );
}

// --- Per-admin console settings ----------------------------------------------

export function getAdminSettings() {
    return request<AdminSettings>('/admin/settings');
}

export function updateAdminSettings(body: AdminSettingsInput) {
    return request<AdminSettings>('/admin/settings', body, { method: 'PUT' });
}
