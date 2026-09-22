import type {
    ActivationRedirect,
    AdminContactsSettings,
    ApiEnvelope,
    Package,
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

const BASE = import.meta.env.VITE_API_URL + '/api/hotspot';

// The NAS hotspot login page hands the client over to the portal with a
// `login_request` id; App.tsx persists it so NAS-bound calls can carry it.
export const LOGIN_REQUEST_KEY = 'radii.loginRequestId';

export function currentLoginRequestId(): string | null {
    return localStorage.getItem(LOGIN_REQUEST_KEY);
}

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

// Support contacts of the admin owning the NAS of the current login request.
export function getContacts(loginRequestId?: string | null) {
    const query = loginRequestId
        ? `?login_request=${encodeURIComponent(loginRequestId)}`
        : '';
    return request<AdminContactsSettings>(`/contacts${query}`);
}

// Pass the login-request id so the API can identify this device (via the
// login request's client MAC) and mark which activation runs on it.
export function getStatus(loginRequestId?: string | null) {
    const query = loginRequestId
        ? `?login_request=${encodeURIComponent(loginRequestId)}`
        : '';
    return request<Array<Quota>>(`/status${query}`);
}

export function createOrder(body: {
    loginRequestKey: string | null;
    packageId: string;
    phoneNumber?: string;
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
    const loginRequestId = currentLoginRequestId();
    const query = loginRequestId
        ? `?login_request=${encodeURIComponent(loginRequestId)}`
        : '';
    return request<{
        paymentId: string;
        status: 'pending' | 'paid' | 'failed';
        message: string;
        activation?: ActivationRedirect | null;
    }>(
        `/payment/${encodeURIComponent(transactionCode)}/verify${query}`,
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
    const method = opts?.method?.toUpperCase() ?? 'GET';
    const logPath = path
        .split('?')[0]
        .replace(/\/(payment|login-request|deauth)\/[^/]+/g, '/$1/:id');
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
