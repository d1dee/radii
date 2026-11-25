import { describe, expect, test } from 'bun:test';
import { createWahaSettingsService, type StoredWahaSettings } from './wahaSettings';
import { adminWhatsAppSessionName, createWahaClient, parseWahaConfig } from './waha';

const globalConfig = parseWahaConfig('https://global.invalid', 'global-secret');
const encryptionKey = 'ab'.repeat(32);

function setup(global = globalConfig, key = encryptionKey) {
    const rows = new Map<string, StoredWahaSettings>();
    const settings = createWahaSettingsService({
        async read(id) { return rows.get(id); },
        async update(id, change) {
            const next = change(rows.get(id));
            rows.set(id, next);
            return next;
        },
    }, global, key);
    const calls: { url: string; init: RequestInit }[] = [];
    const statuses = new Map<string, string>();
    const client = createWahaClient((id) => settings.resolve(id), {
        async fetch(url, init) {
            calls.push({ url, init });
            if (url.endsWith('/auth/qr')) return Response.json({ mimetype: 'image/png', data: 'YWJjZA==' });
            const name = url.split('/').pop()!;
            if (init.method === 'GET') return Response.json({ name, status: statuses.get(name) ?? 'WORKING' });
            return new Response(null, { status: 204 });
        },
    });
    return { rows, settings, client, calls, statuses };
}

describe('per-admin WAHA settings (offline)', () => {
    test('defaults never use configured globals; disabled operations do not contact a provider', async () => {
        const { settings, client, calls } = setup();
        expect(await settings.get('a')).toEqual({ baseUrl: '', useGlobalConfig: false, hasApiKey: false, globalConfigured: true, configured: false });
        expect(await client.getStatus('a')).toEqual({ configured: false, status: 'DISABLED' });
        await expect(client.sendText('a', '+254712345678', 'OTP')).rejects.toMatchObject({ code: 'WAHA_DISABLED' });
        await expect(client.createSession('a')).rejects.toMatchObject({ code: 'WAHA_DISABLED' });
        expect(calls).toHaveLength(0);
    });

    test('tenant settings, encrypted keys and returned public fields are isolated', async () => {
        const { settings, rows } = setup();
        const saved = await settings.save('a', { baseUrl: 'https://a.invalid/', apiKey: 'private-secret', useGlobalConfig: false });
        expect(saved).toEqual({ baseUrl: 'https://a.invalid', useGlobalConfig: false, hasApiKey: true, globalConfigured: true, configured: true });
        expect(await settings.get('a')).toEqual(saved);
        expect(JSON.stringify(saved)).not.toContain('private-secret');
        expect(JSON.stringify(rows.get('a'))).not.toContain('private-secret');
        expect((await settings.get('b')).hasApiKey).toBe(false);
        expect(await settings.resolve('a')).toEqual({ baseUrl: 'https://a.invalid', apiKey: 'private-secret' });
        // Even a database-level cross-tenant copy cannot decrypt another key.
        rows.set('b', rows.get('a')!);
        await expect(settings.resolve('b')).rejects.toMatchObject({ code: 'WAHA_UNAVAILABLE' });
    });

    test('blank/omitted keys preserve ciphertext; clear is explicit; drafts are disabled', async () => {
        const { settings, rows } = setup();
        await settings.save('a', { baseUrl: 'http://a.invalid:3000', apiKey: 'key', useGlobalConfig: false });
        const encrypted = rows.get('a')!.apiKeyEncrypted;
        await settings.save('a', { apiKey: '', useGlobalConfig: false });
        await settings.save('a', { useGlobalConfig: true });
        expect(rows.get('a')!.apiKeyEncrypted).toBe(encrypted);
        expect(await settings.resolve('a')).toEqual(globalConfig);
        await settings.save('a', { useGlobalConfig: false });
        expect((await settings.resolve('a')).apiKey).toBe('key');
        const cleared = await settings.save('a', { clearApiKey: true, useGlobalConfig: false });
        expect(cleared.hasApiKey).toBe(false);
        expect(cleared.configured).toBe(false);
        expect(await settings.resolve('a')).toEqual({ baseUrl: '', apiKey: '' });
    });

    test('explicit global selection wins, even over complete private credentials', async () => {
        const { settings, client, calls } = setup();
        await settings.save('a', { baseUrl: 'https://private.invalid', apiKey: 'key', useGlobalConfig: true });
        expect(calls).toHaveLength(0);
        await client.getStatus('a');
        expect(calls[0]!.url).toStartWith(globalConfig.baseUrl);
        expect(calls[0]!.init.headers).toMatchObject({ 'X-Api-Key': 'global-secret' });
    });

    test('disabled globals do not disable private providers and global selection never falls back', async () => {
        const { settings, client, calls } = setup(parseWahaConfig());
        await settings.save('a', { baseUrl: 'https://a.invalid', apiKey: 'key', useGlobalConfig: false });
        expect((await client.getStatus('a')).configured).toBe(true);
        expect(calls).toHaveLength(1);
        expect((await settings.save('a', { useGlobalConfig: true })).configured).toBe(false);
        expect((await client.getStatus('a')).status).toBe('DISABLED');
        expect(calls).toHaveLength(1);
    });

    test('status, QR, controls and sends resolve the same tenant provider and enforce readiness', async () => {
        const { settings, client, calls, statuses } = setup();
        for (const id of ['a', 'b']) await settings.save(id, { baseUrl: `https://${id}.invalid`, apiKey: `key-${id}`, useGlobalConfig: false });
        await client.getStatus('a');
        await client.createSession('a');
        statuses.set(adminWhatsAppSessionName('a'), 'SCAN_QR_CODE');
        await client.getQr('a');
        for (const action of ['start', 'restart', 'logout', 'delete'] as const) await client.sessionAction('a', action);
        await expect(client.sendText('a', '+254712345678', 'OTP')).rejects.toMatchObject({ code: 'WAHA_NOT_READY' });
        expect(calls.some((call) => call.url.endsWith('/sendText'))).toBe(false);
        await client.sendText('b', '+254712345678', 'OTP');
        const last = calls.at(-1)!;
        expect(last.url).toBe('https://b.invalid/api/sendText');
        expect(JSON.parse(last.init.body as string).session).toBe(adminWhatsAppSessionName('b'));
        for (const call of calls.slice(0, -2)) {
            expect(call.url).toStartWith('https://a.invalid/');
            expect(call.init.headers).toMatchObject({ 'X-Api-Key': 'key-a' });
            expect(call.init.cache).toBe('no-store');
        }
    });

    test('private provider errors and unreadable keys never contact global provider', async () => {
        const { settings, rows } = setup();
        await settings.save('a', { baseUrl: 'https://a.invalid', apiKey: 'key', useGlobalConfig: false });
        const urls: string[] = [];
        const client = createWahaClient((id) => settings.resolve(id), { async fetch(url) {
            urls.push(url);
            return new Response('private upstream secret', { status: 401 });
        } });
        await expect(client.sendText('a', '+254712345678', 'OTP')).rejects.toMatchObject({ code: 'WAHA_UNAVAILABLE', status: 502 });
        expect(urls).toEqual([`https://a.invalid/api/sessions/${adminWhatsAppSessionName('a')}`]);
        rows.get('a')!.apiKeyEncrypted = 'v1.corrupted.key.value';
        await expect(client.getStatus('a')).rejects.toMatchObject({ code: 'WAHA_UNAVAILABLE', status: 503 });
        expect(urls).toHaveLength(1);
        // Global mode is independent of private credential decryption.
        await settings.save('a', { useGlobalConfig: true });
        expect(await settings.resolve('a')).toEqual(globalConfig);
    });

    test('input validation is strict and errors never echo URL or key', async () => {
        const { settings } = setup();
        for (const input of [
            { baseUrl: 'https://user:secret@a.invalid' },
            { baseUrl: 'https://a.invalid/api' },
            { baseUrl: 'https://a.invalid?secret=1' },
            { baseUrl: 'ftp://a.invalid' },
            { apiKey: 'secret with whitespace' },
            { apiKey: 'key', clearApiKey: true },
            { adminId: 'other' },
            { useGlobalConfig: 'true' },
        ]) {
            const result = settings.save('a', { useGlobalConfig: false, ...input });
            await expect(result).rejects.toMatchObject({ code: 'WAHA_INVALID_INPUT', status: 400 });
            await result.catch((error) => expect(error.message).not.toContain('secret'));
        }
        await expect(settings.save('a', {})).rejects.toMatchObject({ code: 'WAHA_INVALID_INPUT' });
        expect(() => parseWahaConfig()).not.toThrow();
        expect(() => parseWahaConfig('https://global.invalid')).toThrow();
    });

    test('missing encryption key rejects private secrets, but permits explicit global mode', async () => {
        const { settings, rows } = setup(globalConfig, '');
        await expect(settings.save('a', { baseUrl: 'https://a.invalid', apiKey: 'do-not-store', useGlobalConfig: false })).rejects.toMatchObject({ status: 503 });
        expect(rows.size).toBe(0);
        await settings.save('a', { useGlobalConfig: true });
        expect(await settings.resolve('a')).toEqual(globalConfig);
    });

    test('rate limits survive configuration switches', async () => {
        const { settings, client } = setup();
        for (let i = 0; i < 10; i++) {
            await settings.save('a', { useGlobalConfig: Boolean(i % 2) });
            await client.sessionAction('a', 'start').catch(() => undefined);
        }
        await expect(client.sessionAction('a', 'start')).rejects.toMatchObject({ code: 'WAHA_RATE_LIMITED' });
    });
});
