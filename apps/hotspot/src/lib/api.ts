import type { Package, StatusQuotas } from '@radii/shared';

// Envelope shared by every REST endpoint on the hotspot backend.
export type ApiEnvelope<T> = {
    success: boolean;
    data?: T;
    error?: string;
    // Present on 4xx validation responses; maps form field -> message.
    fieldErrors?: Record<string, string>;
};

export type MeResult = {
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

// Issue a JSON request against the REST API, unwrap the `{success,data,error}`
// envelope and throw on failure. Cookies (better-auth session) are sent via
// `credentials: 'include'`.
async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
        credentials: 'include',
        ...init,
        headers: {
            'Content-Type': 'application/json',
            ...(init?.headers as Record<string, string> | undefined),
        },
    });

    let json: ApiEnvelope<T>;
    try {
        json = (await res.json()) as ApiEnvelope<T>;
    } catch {
        throw new Error(`Request to ${path} failed (${res.status})`);
    }

    if (!json.success) {
        throw new Error(json.error || `Request to ${path} failed`);
    }
    return json.data as T;
}

export function getPackages() {
    return request<Array<[string, Package[]]>>('/packages');
}

export function getMe() {
    return request<MeResult>('/me');
}

export function getStatus() {
    return request<StatusQuotas>('/status');
}

export function createOrder(body: {
    packageId: string;
    phoneNumber: string;
}) {
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

// --- Auth (phone + PIN) -----------------------------------------------------

// Unlike `request`, auth submission returns a result object instead of
// throwing, so field errors can be surfaced onto the form.
export type AuthResult =
    | { success: true }
    | {
          success: false;
          fieldErrors?: Record<string, string>;
          message?: string;
      };

async function authRequest(
    path: string,
    body: unknown,
): Promise<AuthResult> {
    let res: Response;
    try {
        res = await fetch(`${BASE}${path}`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
    } catch {
        return { success: false, message: 'Could not reach the server. Try again.' };
    }

    let json: ApiEnvelope<null>;
    try {
        json = (await res.json()) as ApiEnvelope<null>;
    } catch {
        return { success: false, message: `Request to ${path} failed (${res.status})` };
    }

    if (json.success) return { success: true };
    return {
        success: false,
        fieldErrors: json.fieldErrors,
        message: json.error,
    };
}

export function register(body: {
    phoneNumber: string;
    pin: string;
    verifyPin: string;
}) {
    return authRequest('/register', body);
}

export function login(body: { phoneNumber: string; pin: string }) {
    return authRequest('/login', body);
}
