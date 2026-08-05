import type { Package, Quota } from '@radii/shared';

// Envelope shared by every REST endpoint on the hotspot backend.
export type ApiEnvelope<T> = {
    success: boolean;
    message: string;
    data?: T;
    error?: string | Record<string, string>;
};

export type Client = {
    userId: string;
    name: string;
    email: string;
    role: string;
    phoneNumber: string;
    prevPaymentMethods: string[];
};

export type OrderResult = {
    paymentId: string;
    status: string;
    amount: number;
    packageId: string;
};

const BASE = '/api/hotspot';

export function getPackages() {
    return request<Array<[string, Package[]]>>('/packages');
}

export function getClientData() {
    return request<Client>('/client');
}

export function getStatus() {
    return request<Array<Quota>>('/status');
}

export function createOrder(body: { packageId: string; phoneNumber: string }) {
    return request<OrderResult>('/order', {
        method: 'POST',
        body: JSON.stringify(body),
    });
}

export function deauthDevice(deviceQuotaId: string) {
    return request<{ deviceQuotaId: string }>(
        `/deauth/${encodeURIComponent(deviceQuotaId)}`,
        { method: 'POST' },
    );
}

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
            body: JSON.stringify(body),
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
    return request('/register', body, { method: 'POST' });
}

export function login(body: { phoneNumber: string; pin: string }) {
    return request('/login', body, { method: 'POST' });
}
