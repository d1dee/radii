import type {
    AdminContactsSettings,
    ApiEnvelope,
    Package,
    PppoeActivation,
    PppoeClient,
    PppoeClientConfig,
    PppoeOrderResult,
    PppoeServiceConfig,
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

export type OrderResult = PppoeOrderResult;

export type { PppoeActivation };

const BASE = import.meta.env.VITE_API_URL + '/api/ppoe';

// Optional NAS scoping for the package listing, captured from the portal URL
// (?nas=<nasDeviceId>) so an operator can link the portal to one router.
const NAS_DEVICE_KEY = 'radii.pppoeNasDeviceId';

const capturedNasDeviceId = new URLSearchParams(window.location.search).get(
    'nas',
);
if (capturedNasDeviceId) {
    localStorage.setItem(NAS_DEVICE_KEY, capturedNasDeviceId);
}

export function currentNasDeviceId(): string | null {
    return localStorage.getItem(NAS_DEVICE_KEY);
}

export function getPackages(nasDeviceId?: string | null) {
    const nas = nasDeviceId ?? currentNasDeviceId();
    const query = nas ? `?nas=${encodeURIComponent(nas)}` : '';
    return request<Array<[string, Package[]]>>(`/packages${query}`);
}

export function getClientData() {
    return request<Client>('/client');
}

// Support contacts of the admin owning the NAS the portal is scoped to.
export function getContacts(nasDeviceId?: string | null) {
    const nas = nasDeviceId ?? currentNasDeviceId();
    const query = nas ? `?nas=${encodeURIComponent(nas)}` : '';
    return request<AdminContactsSettings>(`/contacts${query}`);
}

export function getServiceConfig() {
    return request<PppoeServiceConfig>('/config');
}

// The caller's active PPPoE dialer accounts (credentials + live state).
export function getClients() {
    return request<Array<PppoeClient>>('/clients');
}

// Full dialer configuration for one client (credentials + service defaults).
export function getClientConfig(activationId: string) {
    return request<PppoeClientConfig>(
        `/clients/${encodeURIComponent(activationId)}/config`,
    );
}

// Rotates a dialer's password (live session is cut; the package stays valid).
export function rotateClientPassword(activationId: string) {
    return request<PppoeActivation>(
        `/clients/${encodeURIComponent(activationId)}/rotate-password`,
        {},
        { method: 'POST' },
    );
}

export function getStatus() {
    return request<Array<Quota>>('/status');
}

export function createOrder(body: { packageId: string; phoneNumber: string }) {
    // Send the NAS this portal is scoped to so the purchase is attributed to
    // the owning admin's network (tenant scoping).
    return request<OrderResult>(
        '/order',
        { ...body, nas: currentNasDeviceId() },
        {
            method: 'POST',
        },
    );
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
        activation?: PppoeActivation | null;
    }>(
        `/payment/${encodeURIComponent(transactionCode)}/verify`,
        { transactionCode },
        { method: 'POST' },
    );
}

// Disconnects a dialer's live PPP session (RADIUS Disconnect-Message to the
// NAS). The package itself stays active; the dialer can reconnect using the
// same credentials. Pass sessionId (radacct id) to target one session.
export function deauthDevice(activationId: string, sessionId?: string) {
    const query = sessionId ? `?session=${encodeURIComponent(sessionId)}` : '';
    return request<{
        activationId: string;
        sessionsFound?: number;
        sessionsDisconnected?: number;
    }>(
        `/deauth/${encodeURIComponent(activationId)}${query}`,
        { activationId },
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

export function login(body: { phoneNumber: string; pin: string }) {
    return request('/login', body, { method: 'POST' });
}

export function logout() {
    return request('/logout', {}, { method: 'POST' });
}
