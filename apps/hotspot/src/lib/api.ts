import { ApiErrorType } from '@radii/shared';
import type { ApiEnvelope, Package, Quota } from '@radii/shared';

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

// Packages are scoped to the NAS of the current login request; the API
// errors when the id is missing.
export function getPackages(loginRequestId: string) {
    return request<Array<[string, Package[]]>>(
        `/packages?login_request=${encodeURIComponent(loginRequestId)}`,
    );
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
            message: `Could not parse response from path ${path}`,
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
    return request('/register', body, { method: 'POST' });
}

export type HotspotRedirectData = {
    linkLoginOnly: string;
    dst: string;
    username: string;
    password: string;
    mac: string;
};

export function completeLoginRequest(loginRequestId: string) {
    return request<HotspotRedirectData>(
        `/login-request/${encodeURIComponent(loginRequestId)}/complete`,
        {},
        { method: 'POST' },
    );
}

export function login(body: { phoneNumber: string; pin: string }) {
    return request('/login', body, { method: 'POST' });
}
