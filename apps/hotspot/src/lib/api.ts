import type {
    ActivationRedirect,
    ApiEnvelope,
    Package,
    Quota,
} from '@radii/shared';
import { ApiErrorType } from '@radii/shared';

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
    status: 'pending' | 'paid' | 'failed';
    amount: number;
    packageId: string;
    // Present once the payment is paid and its package was activated on the
    // RADIUS side — the portal auto-submits these credentials to the NAS to
    // get online.
    activation?: ActivationRedirect | null;
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

export function createOrder(body: {
    loginRequestKey: string | null;
    packageId: string;
    phoneNumber: string;
}) {
    return request<OrderResult>('/order', body, {
        method: 'POST',
    });
}

export function getPaymentStatus(paymentId: string) {
    return request<OrderResult>(`/payment/${encodeURIComponent(paymentId)}`);
}

export function getLatestPendingPayment() {
    return request<OrderResult | null>('/payment/pending/latest');
}

export function verifyPaymentReceipt(transactionCode: string) {
    return request<{
        paymentId: string;
        status: 'pending' | 'paid' | 'failed';
        message: string;
        activation?: ActivationRedirect | null;
    }>(
        `/payment/${encodeURIComponent(transactionCode)}/verify`,
        { transactionCode },
        { method: 'POST' },
    );
}

// Disconnects a device's live session of a package (frees a device slot).
// The package itself stays active; the session is killed at the NAS via a
// RADIUS Disconnect-Message. Pass sessionId (radacct id) to target one device.
export function deauthDevice(deviceQuotaId: string, sessionId?: string) {
    const query = sessionId ? `?session=${encodeURIComponent(sessionId)}` : '';
    return request<{
        deviceQuotaId: string;
        sessionsFound?: number;
        sessionsDisconnected?: number;
    }>(
        `/deauth/${encodeURIComponent(deviceQuotaId)}${query}`,
        { deviceQuotaId },
        { method: 'POST' },
    );
}

export async function request<T>(
    path: string,
    body?: unknown,
    opts?: Omit<RequestInit, 'body'>,
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
    activationId?: string | null;
    // Servlet CHAP challenge for http-chap logins; empty when CHAP is off.
    chapId?: string;
    chapChallenge?: string;
};

// Pass activationId to connect one specific device quota (connected-devices
// screen) instead of the user's most recent active activation.
export function completeLoginRequest(
    loginRequestId: string,
    activationId?: string,
) {
    return request<HotspotRedirectData>(
        `/login-request/${encodeURIComponent(loginRequestId)}/complete`,
        activationId ? { activationId } : {},
        { method: 'POST' },
    );
}

export function login(body: { phoneNumber: string; pin: string }) {
    return request('/login', body, { method: 'POST' });
}
