import { describe, expect, mock, test } from 'bun:test';
import type { MiddlewareHandler } from 'hono';
import { createWahaSettingsService, type StoredWahaSettings } from '../lib/wahaSettings';
import { createWahaClient, parseWahaConfig } from '../lib/waha';
import { adminSettingsSchema, maskAdminSettings } from '@radii/shared';

const rows = new Map<string, StoredWahaSettings>();
const settings = createWahaSettingsService({
    async read(id) { return rows.get(id); },
    async update(id, change) { const next = change(rows.get(id)); rows.set(id, next); return next; },
}, parseWahaConfig('https://global.invalid', 'global-secret'), 'ab'.repeat(32));
const calls: string[] = [];
const client = createWahaClient((id) => settings.resolve(id), { async fetch(url) {
    calls.push(url);
    return Response.json({ name: url.split('/').pop(), status: 'WORKING' });
} });

// Test-only identity middleware and transport: no auth server, database or WAHA
// process is loaded. Verify the router never accepts a body-selected tenant.
mock.module('../middleware/auth', () => ({ requireAdmin: (async (c, next) => {
    const id = c.req.header('X-Test-Admin');
    if (!id) return c.json({ success: false }, 401);
    c.set('admin', { id });
    await next();
}) satisfies MiddlewareHandler }));
mock.module('../lib/adminWhatsApp', () => ({
    adminWhatsAppSettings: settings,
    adminWhatsApp: client,
    sendAdminWhatsAppText: client.sendText,
}));
const { default: app } = await import('./adminWhatsApp');

describe('WAHA HTTP configuration contract (offline)', () => {
    test('configuration endpoints require identity and are never cached', async () => {
        for (const method of ['GET', 'PUT']) {
            const response = await app.request('/config', { method });
            expect(response.status).toBe(401);
            expect(response.headers.get('Cache-Control')).toBe('no-store');
            expect(response.headers.get('Pragma')).toBe('no-cache');
        }
    });

    test('save/get are tenant-scoped, secret-free and have no provider side effects', async () => {
        const input = { baseUrl: 'https://a.invalid', apiKey: 'private-secret', useGlobalConfig: false };
        const response = await app.request('/config', {
            method: 'PUT', headers: { 'X-Test-Admin': 'a', 'Content-Type': 'application/json' }, body: JSON.stringify(input),
        });
        expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        const body = await response.json();
        expect(body).toEqual({ success: true, data: {
            baseUrl: 'https://a.invalid', useGlobalConfig: false, hasApiKey: true, configured: true, globalConfigured: true,
        } });
        expect(JSON.stringify(body)).not.toContain('private-secret');
        expect(calls).toHaveLength(0);
        const own = await app.request('/config', { headers: { 'X-Test-Admin': 'a' } });
        expect(await own.json()).toEqual(body);
        const other = await app.request('/config', { headers: { 'X-Test-Admin': 'b' } });
        expect((await other.json()).data.hasApiKey).toBe(false);
        const session = await app.request('/session', { headers: { 'X-Test-Admin': 'a' } });
        expect(session.status).toBe(200);
        expect(calls[0]).toStartWith('https://a.invalid/');
    });

    test('private persistence is excluded from the ordinary settings response schema', () => {
        const publicSettings = maskAdminSettings(adminSettingsSchema.parse({ whatsapp: rows.get('a') }));
        expect(publicSettings).not.toHaveProperty('whatsapp');
        expect(JSON.stringify(publicSettings)).not.toContain('apiKeyEncrypted');
    });

    test('invalid JSON and body tenant overrides return sanitized no-cache errors', async () => {
        for (const body of ['{', JSON.stringify({ adminId: 'b', apiKey: 'private-secret', useGlobalConfig: true })]) {
            const response = await app.request('/config', {
                method: 'PUT', headers: { 'X-Test-Admin': 'a', 'Content-Type': 'application/json' }, body,
            });
            expect(response.status).toBe(400);
            expect(response.headers.get('Cache-Control')).toBe('no-store');
            const result = await response.json();
            expect(result.data.code).toBe('WAHA_INVALID_INPUT');
            expect(JSON.stringify(result)).not.toContain('private-secret');
        }
        expect((await settings.get('a')).useGlobalConfig).toBe(false);
    });
});
