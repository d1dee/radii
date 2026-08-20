import {
    ApiErrorType,
    type ApiEnvelope,
    type GenerateSetupScriptInput,
    type NasDeviceOs,
    type NasDeviceStatus,
} from '@shared/index';

export type { GenerateSetupScriptInput, NasDeviceOs, NasDeviceStatus } from '@shared/index';

const BASE = '/api';

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
