import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { adminWhatsApp, adminWhatsAppSettings, enqueueAdminWhatsApp, getAdminWhatsAppOutbox, cancelAdminWhatsAppOutbox, resumeAdminWhatsAppOutbox } from '../lib/adminWhatsApp';
import { jsonError } from '../lib/error';
import { adminWhatsAppBatchSchema, WahaError } from '../lib/waha';
import { requireAdmin } from '../middleware/auth';
import type { AppVariables } from '../types';

const app = new Hono<{ Variables: AppVariables }>();
app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('Pragma', 'no-cache');
    await next();
});
app.use('*', requireAdmin);
app.use('*', bodyLimit({ maxSize: 20_000, onError: (c) => jsonError(c, 413, 'WhatsApp request body is too large.') }));
app.onError((error, c) => {
    if (error instanceof WahaError) {
        if (error.retryAfter) c.header('Retry-After', String(error.retryAfter));
        return jsonError(c, error.status, error.message, undefined, { code: error.code });
    }
    // Do not let upstream/config/QR values reach the global error logger.
    return jsonError(c, 500, 'WhatsApp request failed.');
});

app.get('/config', async (c) => c.json({ success: true, data: await adminWhatsAppSettings.get(c.var.admin.id) }));
app.put('/config', async (c) => c.json({ success: true, data: await adminWhatsAppSettings.save(c.var.admin.id, await c.req.json().catch(() => null)) }));

app.get('/session', async (c) => c.json({ success: true, data: await adminWhatsApp.getStatus(c.var.admin.id) }));
app.post('/session', async (c) => c.json({ success: true, data: await adminWhatsApp.createSession(c.var.admin.id) }));
app.get('/session/qr', async (c) => c.json({ success: true, data: await adminWhatsApp.getQr(c.var.admin.id) }));
for (const action of ['start', 'restart', 'logout'] as const) {
    app.post(`/session/${action}`, async (c) => c.json({ success: true, data: await adminWhatsApp.sessionAction(c.var.admin.id, action) }));
}
app.delete('/session', async (c) => c.json({ success: true, data: await adminWhatsApp.sessionAction(c.var.admin.id, 'delete') }));
app.post('/send-text', async (c) => {
    const parsed = adminWhatsAppBatchSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return jsonError(c, 400, 'Provide 1-50 international recipients, 1-4096 text characters and a request ID.');
    return c.json({ success: true, data: await enqueueAdminWhatsApp(c.var.admin.id, parsed.data) }, 202);
});
app.get('/outbox', async (c) => c.json({ success: true, data: await getAdminWhatsAppOutbox(c.var.admin.id) }));
app.delete('/outbox', async (c) => c.json({ success: true, data: await cancelAdminWhatsAppOutbox(c.var.admin.id) }));
app.post('/outbox/resume', async (c) => c.json({ success: true, data: await resumeAdminWhatsAppOutbox(c.var.admin.id) }));

export default app;
