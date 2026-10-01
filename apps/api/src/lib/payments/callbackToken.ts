// Signed payment-callback URL tokens.
//
// Every callback URL this server hands to a payment gateway carries a
// `?ct=<token>` query parameter, where token = `<nonce>.<mac>`:
//  - nonce  random per-URL value (hex), also stored on the transaction row
//           (transaction.callbackNonces, keyed by callback event) so async
//           callbacks can additionally be bound to the exact transaction
//           that issued the URL (see service.ts handleProviderCallback);
//  - mac    hex HMAC-SHA256(PAYMENT_CALLBACK_HMAC_SECRET,
//           "<provider>\n<event>\n<nonce>").
//
// The MAC lets the callback route authenticate a delivery BEFORE parsing the
// body or touching the database: only URLs minted by this server carry a
// valid token, so a tenant admin (or any other attacker) cannot forge a
// callback even when they know the correlation ids in the payload.
// Safaricom's Transaction Status callbacks carry no signature of their own;
// this token plus the stored-nonce check and the amount-match requirement
// are what authenticate them.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../../env';

// Fresh random nonce for one callback URL issuance.
export function newCallbackNonce(): string {
    return randomBytes(16).toString('hex');
}

function computeMac(
    providerName: string,
    event: string,
    nonce: string,
): Buffer {
    return createHmac('sha256', env.payments.callbackHmacSecret)
        .update(`${providerName}\n${event}\n${nonce}`)
        .digest();
}

// Appends the signed ?ct= token to a callback URL. A missing nonce yields
// the plain URL (the callback route rejects unauthenticated deliveries, so
// callers must always supply one).
export function signCallbackUrl(
    url: string,
    providerName: string,
    event: string,
    nonce: string | null | undefined,
): string {
    if (!nonce) return url;
    const token = `${nonce}.${computeMac(providerName, event, nonce).toString('hex')}`;
    return `${url}${url.includes('?') ? '&' : '?'}ct=${token}`;
}

// Constant-time verification of an inbound ?ct= token against the route's
// provider/event. Returns the embedded nonce on success so the caller can
// bind the callback to the stored transaction row.
export function verifyCallbackToken(
    providerName: string,
    event: string,
    token: string | null | undefined,
): { valid: boolean; nonce: string | null } {
    if (!token) return { valid: false, nonce: null };
    const separator = token.lastIndexOf('.');
    if (separator <= 0 || separator === token.length - 1) {
        return { valid: false, nonce: null };
    }
    const nonce = token.slice(0, separator);
    const provided = Buffer.from(token.slice(separator + 1), 'utf8');
    const expected = Buffer.from(
        computeMac(providerName, event, nonce).toString('hex'),
        'utf8',
    );
    if (
        provided.length !== expected.length ||
        !timingSafeEqual(provided, expected)
    ) {
        return { valid: false, nonce: null };
    }
    return { valid: true, nonce };
}
