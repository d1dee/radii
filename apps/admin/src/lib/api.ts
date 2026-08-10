// Envelope shared by every REST endpoint on the hotspot backend.
export type ApiEnvelope<T> = {
    success: boolean;
    message: string;
    data?: T;
    error?: string | Record<string, string>;
};

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
    } catch (e) {
        return {
            success: false,
            message: 'Could not reach the server. Try again.',
        };
    }

    let json: ApiEnvelope<T>;
    try {
        json = await res.json();
    } catch {
        return {
            success: false,
            message: `Request to ${path} failed (${res.status})`,
        };
    }

    if (!json.success)
        return {
            success: false,
            error: json?.error,
            message: json.message,
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
    nasConfigId: string | null;
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
    nasConfigId?: string;
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
