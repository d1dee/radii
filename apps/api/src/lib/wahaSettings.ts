import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { parseWahaConfig, WahaError, type WahaConfig } from './waha';

const storedSchema = z.object({
    baseUrl: z.string().default(''),
    apiKeyEncrypted: z.string().default(''),
    useGlobalConfig: z.boolean().default(false),
});
export type StoredWahaSettings = z.infer<typeof storedSchema>;
export const wahaSettingsInputSchema = z.object({
    baseUrl: z.string().max(2048).optional(),
    apiKey: z.string().max(4096).optional(),
    useGlobalConfig: z.boolean(),
    clearApiKey: z.boolean().optional(),
}).strict();

// Separate from auth signing secrets. AES-GCM also binds ciphertext to its
// owning tenant so copying a stored document cannot transfer credentials.
export function createWahaSettingsService(store: {
    read(adminId: string): Promise<unknown>;
    update(adminId: string, change: (previous: unknown) => StoredWahaSettings): Promise<StoredWahaSettings>;
}, globalConfig: WahaConfig, encryptionKey: string) {
    function key() {
        if (!/^[a-fA-F0-9]{64}$/.test(encryptionKey)) {
            throw new WahaError('WAHA_UNAVAILABLE', 503, 'WhatsApp credential encryption is not configured. Contact the server operator.');
        }
        return Buffer.from(encryptionKey, 'hex');
    }
    function decrypt(adminId: string, encrypted: string) {
        if (!encrypted) return '';
        try {
            const [version, iv, tag, data] = encrypted.split('.');
            if (version !== 'v1' || !iv || !tag || !data) throw new Error();
            const cipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
            cipher.setAAD(Buffer.from(adminId));
            cipher.setAuthTag(Buffer.from(tag, 'base64'));
            return Buffer.concat([cipher.update(Buffer.from(data, 'base64')), cipher.final()]).toString('utf8');
        } catch {
            throw new WahaError('WAHA_UNAVAILABLE', 503, 'WhatsApp stored credentials cannot be read. Re-enter the API key or contact the server operator.');
        }
    }
    function publicSettings(settings: StoredWahaSettings) {
        const globalConfigured = Boolean(globalConfig.baseUrl && globalConfig.apiKey);
        return {
            baseUrl: settings.baseUrl,
            useGlobalConfig: settings.useGlobalConfig,
            hasApiKey: Boolean(settings.apiKeyEncrypted),
            globalConfigured,
            configured: settings.useGlobalConfig ? globalConfigured : Boolean(settings.baseUrl && settings.apiKeyEncrypted),
        };
    }
    return {
        async get(adminId: string) {
            return publicSettings(storedSchema.parse(await store.read(adminId) ?? {}));
        },
        async save(adminId: string, input: unknown) {
            const parsed = wahaSettingsInputSchema.safeParse(input);
            if (!parsed.success) throw new WahaError('WAHA_INVALID_INPUT', 400, 'Invalid WhatsApp configuration.');
            const next = parsed.data;
            if (next.clearApiKey && next.apiKey) throw new WahaError('WAHA_INVALID_INPUT', 400, 'Cannot set and clear the API key together.');
            const settings = await store.update(adminId, (previous) => {
                const current = storedSchema.parse(previous ?? {});
                const baseUrl = next.baseUrl ?? current.baseUrl;
                // Permit incomplete drafts and explicit clearing, but validate
                // each supplied value using exactly the client's origin/key rules.
                let normalizedUrl = '';
                try {
                    if (baseUrl) normalizedUrl = parseWahaConfig(baseUrl, 'validation-only').baseUrl;
                    if (next.apiKey) parseWahaConfig('https://validation.invalid', next.apiKey);
                } catch {
                    throw new WahaError('WAHA_INVALID_INPUT', 400, 'Use an HTTP(S) origin without credentials, path, query or fragment and an API key without whitespace.');
                }
                let apiKeyEncrypted = next.clearApiKey ? '' : current.apiKeyEncrypted;
                if (next.apiKey) {
                    const iv = randomBytes(12);
                    const cipher = createCipheriv('aes-256-gcm', key(), iv);
                    cipher.setAAD(Buffer.from(adminId));
                    const data = Buffer.concat([cipher.update(next.apiKey, 'utf8'), cipher.final()]);
                    apiKeyEncrypted = ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.');
                }
                return { baseUrl: normalizedUrl, apiKeyEncrypted, useGlobalConfig: next.useGlobalConfig };
            });
            // Saves never contact either provider. Old sessions remain untouched.
            return publicSettings(settings);
        },
        async resolve(adminId: string): Promise<WahaConfig> {
            const settings = storedSchema.parse(await store.read(adminId) ?? {});
            if (settings.useGlobalConfig) return globalConfig;
            if (!settings.baseUrl || !settings.apiKeyEncrypted) return { baseUrl: '', apiKey: '' };
            try {
                return parseWahaConfig(settings.baseUrl, decrypt(adminId, settings.apiKeyEncrypted));
            } catch {
                // Never retry or fall back to global configuration on private errors.
                throw new WahaError('WAHA_UNAVAILABLE', 503, 'WhatsApp private configuration cannot be used. Check your configuration or contact the server operator.');
            }
        },
    };
}
