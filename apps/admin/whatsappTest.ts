import { describe, expect, test } from 'bun:test';

import { settingsCategories } from './src/lib/settingsCategories';
import { isWhatsAppConfig, isWhatsAppSession, validateWhatsAppConfig, whatsAppStates } from './src/lib/whatsapp';

describe('WhatsApp configuration', () => {
    const config = { baseUrl: '', useGlobalConfig: false, hasApiKey: false, globalConfigured: false, configured: false };

    test('accepts an unconfigured private default and configured global settings', () => {
        expect(isWhatsAppConfig(config)).toBe(true);
        expect(isWhatsAppConfig({ ...config, useGlobalConfig: true, globalConfigured: true, configured: true })).toBe(true);
    });

    test('rejects malformed or secret-bearing configuration responses', () => {
        for (const value of [null, {}, { ...config, hasApiKey: 'yes' }, { ...config, apiKey: 'secret' }, { ...config, apiKeyEncrypted: 'secret' }]) {
            expect(isWhatsAppConfig(value)).toBe(false);
        }
    });

    test('permits omitted private values, explicit URL clearing and blank key preservation', () => {
        expect(validateWhatsAppConfig({ useGlobalConfig: true })).toBeNull();
        expect(validateWhatsAppConfig({ useGlobalConfig: false, baseUrl: '', apiKey: '' })).toBeNull();
        expect(validateWhatsAppConfig({ useGlobalConfig: false, clearApiKey: true })).toBeNull();
    });

    test('accepts HTTP and HTTPS origins with optional ports', () => {
        for (const baseUrl of ['https://waha.example.com', 'http://192.168.1.10:3000/']) {
            expect(validateWhatsAppConfig({ useGlobalConfig: false, baseUrl, apiKey: 'replacement-key' })).toBeNull();
        }
    });

    test('rejects URLs containing credentials, paths, queries or fragments', () => {
        for (const baseUrl of ['invalid', 'ftp://waha.example.com', 'https://user:secret@waha.example.com', 'https://waha.example.com/api', 'https://waha.example.com?key=secret', 'https://waha.example.com#secret', `https://${'x'.repeat(2049)}.com`]) {
            const error = validateWhatsAppConfig({ useGlobalConfig: false, baseUrl });
            expect(error).toBeString();
            expect(error).not.toContain(baseUrl);
        }
    });

    test('rejects simultaneous key replacement and clearing', () => {
        expect(validateWhatsAppConfig({ useGlobalConfig: false, apiKey: 'replacement-key', clearApiKey: true })).toBeString();
    });

    test('rejects invalid keys without including them in errors', () => {
        for (const apiKey of [' leading-space', 'line\nbreak', '\u007f', '\u00e9', 'x'.repeat(4097)]) {
            const error = validateWhatsAppConfig({ useGlobalConfig: false, apiKey });
            expect(error).toBeString();
            expect(error).not.toContain(apiKey);
        }
    });
});

describe('WhatsApp messaging settings navigation and state', () => {
    test('exposes a dedicated Messaging category for desktop and mobile settings navigation', () => {
        const category = settingsCategories.find((item) => item.id === 'messaging');
        expect(category?.label).toBe('Messaging');
        expect(category?.description).toContain('WAHA');
        expect(settingsCategories.filter((item) => item.id === 'messaging')).toHaveLength(1);
    });

    test('directs unconfigured admins to Settings instead of the removed inline form', () => {
        expect(whatsAppStates.DISABLED.description).toContain('Settings / Messaging');
        expect(whatsAppStates.DISABLED.description).not.toContain('above');
    });

    test('accepts effective configuration transitions from the session endpoint', () => {
        expect(isWhatsAppSession({ configured: false, status: 'DISABLED' })).toBe(true);
        expect(isWhatsAppSession({ configured: true, status: 'NOT_CREATED' })).toBe(true);
        expect(isWhatsAppSession({ configured: true, status: 'WORKING' })).toBe(true);
        expect(isWhatsAppSession({ configured: false, status: 'WORKING' })).toBe(false);
        expect(isWhatsAppSession({ configured: true, status: 'DISABLED' })).toBe(false);
    });
});
