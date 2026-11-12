export class PortalError extends Error {
    status: number;
    constructor(message: string, status = 0) {
        super(message);
        this.status = status;
    }
}

export async function request<T>(
    path: string,
    body?: unknown,
    signal?: AbortSignal,
): Promise<T> {
    let response: Response;
    try {
        response = await fetch(`/api/agents${path}`, {
            method: body === undefined ? 'GET' : 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
            signal,
            headers:
                body === undefined
                    ? { Accept: 'application/json' }
                    : {
                          Accept: 'application/json',
                          'Content-Type': 'application/json',
                      },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError')
            throw error;
        throw new PortalError(
            'Cannot reach the agent service. Check your connection and retry.',
        );
    }
    let result;
    try {
        result = await response.json();
    } catch {
        throw new PortalError(
            'The service returned an unreadable response. Refresh and retry.',
            response.status >= 500 ? response.status : 0,
        );
    }
    if (!response.ok || result.success !== true || result.data === undefined) {
        const message =
            response.status === 401
                ? 'Your agent session has expired. Sign in again. Any saved withdrawal request will keep its original identity.'
                : response.status === 403
                  ? typeof result.message === 'string' &&
                    result.message.startsWith('Password confirmation failed')
                      ? result.message
                      : 'Access is unavailable. Your membership may be revoked, your agent record archived, or your email unverified. Contact your operator.'
                  : response.status === 404
                    ? 'This agent account or record is unavailable. Your operator may have revoked access or archived the agent. Contact them to review access.'
                    : typeof result.message === 'string' &&
                        result.message !== 'Unauthorized'
                      ? result.message
                      : 'The request could not be completed. Refresh and retry.';
        throw new PortalError(message, response.status);
    }
    return result.data as T;
}

export type Page<T> = {
    items: T[];
    total: number;
    page: number;
    perPage: number;
};
export type Membership = { agentId: string; name: string; tenantName: string };
export type Balance = {
    currency: string;
    available: string;
    reserved: string;
    paid: string;
    earned: string;
};
export type PayoutProfile = {
    id: string;
    method: 'mpesa' | 'bank';
    accountName: string;
    destination: string;
    verifiedAt: string | null;
    createdAt: string;
};
