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
import { apiLogger } from './logging.ts';

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

// Persists (or clears, with null) the network the portal is scoped to. Driven
// by the account switcher — every PPPoE account is bound to one NAS device,
// so selecting an account selects its network.
export function setNasDeviceId(nasDeviceId: string | null) {
    if (nasDeviceId) {
        localStorage.setItem(NAS_DEVICE_KEY, nasDeviceId);
    } else {
        localStorage.removeItem(NAS_DEVICE_KEY);
    }
}

function withNas(path: string, nasDeviceId = currentNasDeviceId()) {
    const separator = path.includes('?') ? '&' : '?';
    return `${path}${separator}nas=${encodeURIComponent(nasDeviceId ?? '')}`;
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
    return request<Array<PppoeClient>>(withNas('/clients'));
}

// Full dialer configuration for one client (credentials + service defaults).
export function getClientConfig(accountId: string) {
    return request<PppoeClientConfig>(
        `/clients/${encodeURIComponent(accountId)}/config`,
    );
}

// Rotates a dialer's password (live session is cut; the package stays valid).
export function rotateClientPassword(accountId: string) {
    return request<PppoeActivation>(
        `/clients/${encodeURIComponent(accountId)}/rotate-password`,
        {},
        { method: 'POST' },
    );
}

export function getStatus(accountId: string) {
    return request<Array<Quota>>(
        `/status?account=${encodeURIComponent(accountId)}`,
    );
}

export function createOrder(body: {
    packageId: string;
    phoneNumber?: string;
    serviceAccountId: string | null;
}) {
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
    return request<OrderResult>(
        withNas(`/payment/${encodeURIComponent(paymentId)}`),
    );
}

export function getLatestPendingPayment() {
    return request<OrderResult | null>(withNas('/payment/pending/latest'));
}

export function verifyPaymentReceipt(transactionCode: string) {
    return request<{
        paymentId: string;
        status: 'pending' | 'paid' | 'failed';
        message: string;
        activation?: PppoeActivation | null;
    }>(
        withNas(`/payment/${encodeURIComponent(transactionCode)}/verify`),
        { transactionCode },
        { method: 'POST' },
    );
}

// Disconnects a dialer's live PPP session (RADIUS Disconnect-Message to the
// NAS). The package itself stays active; the dialer can reconnect using the
// same credentials. Pass sessionId (radacct id) to target one session.
export function deauthDevice(
    activationId: string,
    accountId: string,
    sessionId?: string,
) {
    const query = sessionId ? `?session=${encodeURIComponent(sessionId)}` : '';
    return request<{
        activationId: string;
        sessionsFound?: number;
        sessionsDisconnected?: number;
    }>(
        `/deauth/${encodeURIComponent(activationId)}${query}`,
        { accountId },
        { method: 'POST' },
    );
}

export async function request<T>(
    path: string,
    body?: unknown,
    opts?: Omit<RequestInit, 'body'>,
): Promise<ApiEnvelope<T>> {
    const method = opts?.method?.toUpperCase() ?? 'GET';
    // Sanitized for logs only: strip the query string and collapse dynamic id
    // segments so account ids, payment ids, and receipt codes never reach logs.
    const logPath = path
        .split('?')[0]
        .replace(/\/(clients|payment|deauth)\/[^/]+/g, '/$1/:id');
    const context = (status?: number, requestId?: string | null) => ({
        method,
        path: logPath,
        ...(status === undefined ? {} : { status }),
        ...(requestId ? { requestId } : {}),
    });
    let res: Response;
    try {
        res = await fetch(`${BASE}${path}`, {
            method,
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            ...opts,
        });
    } catch (error) {
        apiLogger.warning('API fetch failed for {method} {path}.', {
            ...context(),
            errorName: error instanceof Error ? error.name : 'UnknownError',
            offline: typeof navigator !== 'undefined' && !navigator.onLine,
        });
        return {
            success: false,
            message:
                typeof navigator !== 'undefined' && !navigator.onLine
                    ? 'You appear to be offline. Check your connection and try again.'
                    : 'Could not reach the server. Check your connection and try again.',
            type: ApiErrorType.NETWORK_ERROR,
        };
    }

    const requestId =
        res.headers.get('x-request-id') ??
        res.headers.get('x-correlation-id') ??
        res.headers.get('trace-id');
    let json: unknown;
    try {
        json = await res.json();
    } catch (error) {
        apiLogger.warning('API response was not valid JSON for {method} {path}.', {
            ...context(res.status, requestId),
            contentType: res.headers.get('content-type'),
            errorName: error instanceof Error ? error.name : 'UnknownError',
        });
        return {
            success: false,
            message: statusMessage(res.status),
            type: errorTypeForStatus(res.status),
        };
    }

    if (!isApiEnvelope<T>(json)) {
        apiLogger.warning(
            'API response had an invalid envelope for {method} {path}.',
            context(res.status, requestId),
        );
        return {
            success: false,
            message: statusMessage(res.status),
            type: errorTypeForStatus(res.status),
        };
    }

    if (!res.ok || !json.success) {
        apiLogger.warning('API request failed for {method} {path}.', {
            ...context(res.status, requestId),
            errorType: !json.success
                ? json.type
                : errorTypeForStatus(res.status),
            protocolMismatch: json.success,
        });
        if (!json.success) return json;
        return {
            success: false,
            message: statusMessage(res.status),
            type: errorTypeForStatus(res.status),
        };
    }

    apiLogger.debug(
        'API request completed for {method} {path}.',
        context(res.status, requestId),
    );
    return json;
}

const apiErrorTypes = new Set<string>(Object.values(ApiErrorType));

function isApiEnvelope<T>(value: unknown): value is ApiEnvelope<T> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }
    const envelope = value as Record<string, unknown>;
    if (envelope.success === true) return true;
    return (
        envelope.success === false &&
        typeof envelope.message === 'string' &&
        envelope.message.trim().length > 0 &&
        typeof envelope.type === 'string' &&
        apiErrorTypes.has(envelope.type) &&
        (envelope.data === undefined ||
            (typeof envelope.data === 'object' &&
                envelope.data !== null &&
                !Array.isArray(envelope.data)))
    );
}

function errorTypeForStatus(status: number) {
    if (status === 401) return ApiErrorType.UNAUTHORIZED;
    if (status === 403) return ApiErrorType.FORBIDDEN;
    if (status === 404) return ApiErrorType.NOT_FOUND;
    if (status === 409) return ApiErrorType.CONFLICT;
    if (status >= 500) return ApiErrorType.INTERNAL_ERROR;
    return ApiErrorType.NETWORK_ERROR;
}

function statusMessage(status: number) {
    if (status === 401) return 'Your session has expired. Sign in and try again.';
    if (status === 403) return 'You do not have permission to complete this request.';
    if (status === 404) return 'The requested item could not be found.';
    if (status === 409) return 'The request conflicts with the current server state. Refresh and try again.';
    if (status === 429) return 'Too many requests. Wait a moment and try again.';
    if (status >= 500) return 'The server could not complete the request. Try again shortly.';
    return 'The server returned an invalid response. Try again.';
}

export function register(body: {
    phoneNumber: string;
    pin: string;
    verifyPin: string;
    claimCode?: string;
}) {
    return request('/register', body, { method: 'POST' });
}

export function login(body: { phoneNumber: string; pin: string }) {
    return request('/login', body, { method: 'POST' });
}

// Forget-PIN: request a 6-digit SMS reset code, then redeem it for a new PIN.
export function forgotPin(body: { phoneNumber: string }) {
    return request('/forgot-pin', body, { method: 'POST' });
}

export function resetPin(body: {
    phoneNumber: string;
    otp: string;
    pin: string;
    verifyPin: string;
}) {
    return request('/reset-pin', body, { method: 'POST' });
}

export function logout() {
    return request('/logout', {}, { method: 'POST' });
}
