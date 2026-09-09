import { Hono } from 'hono';
import { paymentService } from '../lib/payments';

const app = new Hono();

// Generic inbound webhook endpoint for every registered payment provider.
// Gateways POST here (URL given to them at initiation time); the payload is
// handed to the owning provider which normalizes it, and the core reconciles
// the matching transaction. Public on purpose: no session exists for
// gateway-to-server callbacks.
app.post('/callback/:provider/:event', async (c) => {
    const provider = c.req.param('provider');
    const event = c.req.param('event');

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
    );
    return c.json(body, status);
});

export default app;
