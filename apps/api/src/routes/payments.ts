import { Hono } from 'hono';
import { paymentService } from '../lib/payments';
import {
    isCallbackSourceAllowed,
    resolveCallbackSourceIp,
} from '../lib/payments/callbackIp';
import { verifyCallbackToken } from '../lib/payments/callbackToken';
import { paymentLogWarn } from '../lib/payments/log';

const app = new Hono();

// Generic inbound webhook endpoint for every registered payment provider.
// Gateways POST here (URL given to them at initiation time); the payload is
// handed to the owning provider which normalizes it, and the core reconciles
// the matching transaction. Public on purpose: no session exists for
// gateway-to-server callbacks.
//
// Authentication happens BEFORE any body parsing or database access:
//  1. optional source-IP allowlist (MPESA_CALLBACK_IP_ALLOWLIST);
//  2. the signed ?ct= token minted into every callback URL this server
//     hands out (HMAC over provider + event + per-transaction nonce, see
//     lib/payments/callbackToken.ts).
// Rejected deliveries are logged and answered with the same generic 200
// success body a real gateway expects, so failures leak nothing to the
// caller and gateways do not retry-storm.
app.post('/callback/:provider/:event', async (c) => {
    const provider = c.req.param('provider');
    const event = c.req.param('event');

    if (!isCallbackSourceAllowed(c)) {
        paymentLogWarn('callback_rejected_source_ip', {
            provider,
            event,
            sourceIp: resolveCallbackSourceIp(c),
        });
        return c.json({ success: true });
    }

    const { valid, nonce } = verifyCallbackToken(
        provider,
        event,
        c.req.query('ct'),
    );
    if (!valid) {
        paymentLogWarn('callback_rejected_token', {
            provider,
            event,
            sourceIp: resolveCallbackSourceIp(c),
        });
        return c.json({ success: true });
    }

    const payload: unknown = await c.req.json().catch(() => null);
    if (payload === null || typeof payload !== 'object') {
        return c.json(
            { success: false, message: 'Expected a JSON payload.' },
            400,
        );
    }

    const { status, body } = await paymentService.handleProviderCallback(
        provider,
        event,
        payload,
        nonce,
    );
    return c.json(body, status);
});

export default app;
