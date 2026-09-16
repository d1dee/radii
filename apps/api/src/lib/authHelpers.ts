// Phone+PIN portal authentication shared by the customer-facing portals
// (hotspot, PPPoE). Both portals authenticate the same better-auth users:
// the username is the phone number and the password a 4-digit PIN, with a
// synthetic per-phone email kept unique so one phone maps to exactly one
// account no matter which portal it registered on.

import { loginSchema, signUpSchema } from '@radii/shared';
import { APIError } from 'better-auth/api';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { auth } from '../auth';
import type { AppContext } from '../types';
import { jsonError, jsonFieldErrors } from './error';
import {
    claimPppoeAccount,
    pendingPppoeClaimExists,
} from './pppoeAccounts';

function normalizePhone(phone: string) {
    return phone.replace(/\D/g, '');
}

export function fieldErrorsFromIssues(
    issues: Array<{ path: Array<unknown>; message: string }>,
): Record<string, string> {
    const out: Record<string, string> = {};
    for (const issue of issues) {
        const key =
            issue.path
                .map((p) =>
                    typeof p === 'object' && p !== null
                        ? String((p as { key?: unknown }).key)
                        : String(p),
                )
                .join('.') || 'form';
        if (!out[key]) out[key] = issue.message;
    }
    return out;
}

export function forwardCookies(
    c: AppContext,
    headers: Headers,
    body: unknown,
) {
    const res = c.json(body);
    for (const cookie of headers.getSetCookie()) {
        res.headers.append('Set-Cookie', cookie);
    }
    return res;
}

export function respondAuthError(c: AppContext, err: unknown) {
    if (err instanceof APIError) {
        const code = String((err as { code?: string }).code || '').toLowerCase();
        const message = (err.message || '').toLowerCase();
        if (
            code.includes('exists') ||
            code.includes('taken') ||
            message.includes('already') ||
            message.includes('exist')
        ) {
            return jsonFieldErrors(
                c,
                409,
                { phoneNumber: 'Phone number already registered' },
                'Phone number already registered',
            );
        }
        if (
            message.includes('password') ||
            message.includes('credential') ||
            message.includes('invalid')
        ) {
            return jsonFieldErrors(
                c,
                401,
                { pin: 'Invalid phone number or PIN' },
                'Invalid phone number or PIN',
            );
        }
        return jsonError(
            c,
            (err.status as ContentfulStatusCode) || 400,
            err.message || 'Authentication failed',
        );
    }
    return jsonError(c, 500, 'Authentication failed');
}

// POST /register equivalent: creates the better-auth user (phone = username,
// PIN = password) and forwards the session cookies to the client.
export async function registerPhonePin(c: AppContext) {
    const parsed = signUpSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
        return jsonFieldErrors(
            c,
            400,
            fieldErrorsFromIssues(parsed.error.issues),
        );
    }

    const { phoneNumber, pin, claimCode } = parsed.data;

    if (
        claimCode &&
        !(await pendingPppoeClaimExists(phoneNumber, claimCode))
    ) {
        return jsonFieldErrors(
            c,
            400,
            { claimCode: 'Claim code does not match this phone number' },
            'Invalid PPPoE claim code',
        );
    }

    try {
        const { headers, response } = await auth.api.signUpEmail({
            body: {
                // Synthetic unique email derived from the phone; shared across
                // portals so a phone registers once for all of them.
                email: `${normalizePhone(phoneNumber)}@hotspot.local`,
                name: phoneNumber,
                password: pin,
                username: phoneNumber,
            },
            headers: c.req.raw.headers,
            returnHeaders: true,
        });

        if (claimCode) {
            const claimed = await claimPppoeAccount(
                response.user.id,
                phoneNumber,
                claimCode,
            );
            if (!claimed) {
                return jsonFieldErrors(
                    c,
                    409,
                    { claimCode: 'Claim code was already used or replaced' },
                    'Could not claim PPPoE account',
                );
            }
        }

        return forwardCookies(c, headers, { success: true, data: null });
    } catch (err) {
        return respondAuthError(c, err);
    }
}

// POST /login equivalent: signs in with phone + PIN (better-auth username
// plugin) and forwards the session cookies to the client.
export async function loginPhonePin(c: AppContext) {
    const parsed = loginSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
        return jsonFieldErrors(
            c,
            400,
            fieldErrorsFromIssues(parsed.error.issues),
        );
    }

    try {
        const { headers } = await auth.api.signInUsername({
            body: {
                username: parsed.data.phoneNumber,
                password: parsed.data.pin,
            },
            headers: c.req.raw.headers,
            returnHeaders: true,
        });

        return forwardCookies(c, headers, { success: true, data: null });
    } catch (err) {
        return respondAuthError(c, err);
    }
}

// POST /logout equivalent: ends the better-auth session and forwards the
// cleared session cookies.
export async function logoutPhonePin(c: AppContext) {
    try {
        const { headers } = await auth.api.signOut({
            headers: c.req.raw.headers,
            returnHeaders: true,
        });
        return forwardCookies(c, headers, { success: true, data: null });
    } catch {
        return jsonError(c, 400, 'Could not sign out');
    }
}
