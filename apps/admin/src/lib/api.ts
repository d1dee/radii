// Envelope shared by every REST endpoint on the hotspot backend.
export type ApiEnvelope<T> = {
    success: boolean;
    message: string;
    data?: T;
    error?: string | Record<string, string>;
};

const BASE = '/api/admin';

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
