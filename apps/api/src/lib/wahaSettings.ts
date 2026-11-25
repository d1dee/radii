import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { adminWhatsAppSessionName, createWahaClient, parseWahaConfig, WahaError, type WahaConfig, type WahaSessionConfig } from './waha';

const storedSchema = z.object({
    baseUrl: z.string().default(''),
    apiKeyEncrypted: z.string().default(''),
    useGlobalConfig: z.boolean().default(false),
    sessionName: z.union([z.literal(''), z.string().regex(/^radii_admin_[A-Za-z0-9_-]{8}$/)]).default(''),
});
export type StoredWahaSettings = z.infer<typeof storedSchema>;
export const wahaSettingsInputSchema = z
    .object({
        baseUrl: z.string().max(2048).optional(),
        apiKey: z.string().max(4096).optional(),
        useGlobalConfig: z.boolean(),
        clearApiKey: z.boolean().optional(),
    })
    .strict();

// Separate from auth signing secrets. AES-GCM also binds ciphertext to its
// owning tenant so copying a stored document cannot transfer credentials.
export function createWahaSettingsService(
    store: {
        read(adminId: string): Promise<unknown>;
        update(
            adminId: string,
            change: (previous: unknown) => StoredWahaSettings,
        ): Promise<StoredWahaSettings>;
    },
    globalConfig: WahaConfig,
    encryptionKey: string,
    transportOptions: Parameters<typeof createWahaClient>[1] = {},
) {
    function key() {
        if (!/^[a-fA-F0-9]{64}$/.test(encryptionKey)) {
            throw new WahaError(
                'WAHA_UNAVAILABLE',
                503,
                'WhatsApp credential encryption is not configured. Contact the server operator.',
            );
        }
        return Buffer.from(encryptionKey, 'hex');
    }
    function decrypt(adminId: string, encrypted: string) {
        if (!encrypted) return '';
        try {
            const [version, iv, tag, data] = encrypted.split('.');
            if (version !== 'v1' || !iv || !tag || !data) throw new Error();
            const cipher = createDecipheriv(
                'aes-256-gcm',
                key(),
                Buffer.from(iv, 'base64'),
            );
            cipher.setAAD(Buffer.from(adminId));
            cipher.setAuthTag(Buffer.from(tag, 'base64'));
            return Buffer.concat([
                cipher.update(Buffer.from(data, 'base64')),
                cipher.final(),
            ]).toString('utf8');
        } catch {
            throw new WahaError(
                'WAHA_UNAVAILABLE',
                503,
                'WhatsApp stored credentials cannot be read. Re-enter the API key or contact the server operator.',
            );
        }
    }
    function publicSettings(adminId: string, settings: StoredWahaSettings) {
        const globalConfigured = Boolean(
            globalConfig.baseUrl && globalConfig.apiKey,
        );
        let apiKeyPreview: string | null = null;
        if (settings.apiKeyEncrypted) {
            try {
                const apiKey = decrypt(adminId, settings.apiKeyEncrypted);
                // Always conceal at least one character, including for tiny keys.
                if (apiKey)
                    apiKeyPreview = `${apiKey.slice(0, Math.min(4, apiKey.length - 1))}*********************`;
            } catch {
                // A preview must not prevent replacement, clearing or mode changes.
            }
        }
        return {
            baseUrl: settings.baseUrl,
            useGlobalConfig: settings.useGlobalConfig,
            hasApiKey: Boolean(settings.apiKeyEncrypted),
            apiKeyPreview,
            globalConfigured,
            configured: settings.useGlobalConfig
                ? globalConfigured
                : Boolean(settings.baseUrl && settings.apiKeyEncrypted),
        };
    }
    return {
        async get(adminId: string) {
            return publicSettings(
                adminId,
                storedSchema.parse((await store.read(adminId)) ?? {}),
            );
        },
        async save(adminId: string, input: unknown) {
            const parsed = wahaSettingsInputSchema.safeParse(input);
            if (!parsed.success)
                throw new WahaError(
                    'WAHA_INVALID_INPUT',
                    400,
                    'Invalid WhatsApp configuration.',
                );
            const next = parsed.data;
            if (next.clearApiKey && next.apiKey)
                throw new WahaError(
                    'WAHA_INVALID_INPUT',
                    400,
                    'Cannot set and clear the API key together.',
                );
            const current = storedSchema.parse((await store.read(adminId)) ?? {});
            const baseUrl = next.baseUrl ?? current.baseUrl;
            // Validate supplied private values even when switching to global mode.
            let normalizedUrl = '';
            try {
                if (baseUrl)
                    normalizedUrl = parseWahaConfig(baseUrl, 'validation-only').baseUrl;
                if (next.apiKey)
                    parseWahaConfig('https://validation.invalid', next.apiKey);
            } catch {
                throw new WahaError(
                    'WAHA_INVALID_INPUT', 400,
                    'Use an HTTP(S) origin without credentials, path, query or fragment and an API key without whitespace.',
                );
            }
            let apiKeyEncrypted = next.clearApiKey ? '' : current.apiKeyEncrypted;
            if (next.apiKey) {
                const iv = randomBytes(12);
                const cipher = createCipheriv('aes-256-gcm', key(), iv);
                cipher.setAAD(Buffer.from(adminId));
                const data = Buffer.concat([
                    cipher.update(next.apiKey, 'utf8'), cipher.final(),
                ]);
                apiKeyEncrypted = [
                    'v1', iv.toString('base64'),
                    cipher.getAuthTag().toString('base64'), data.toString('base64'),
                ].join('.');
            }
            const candidate = {
                baseUrl: normalizedUrl,
                apiKeyEncrypted,
                useGlobalConfig: next.useGlobalConfig,
                sessionName: current.sessionName || adminWhatsAppSessionName(),
            };
            // Explicit removal disables private integration without contacting a provider.
            // Otherwise partial active configuration is an error, not a saved draft.
            const removing = !next.useGlobalConfig && (next.clearApiKey || next.baseUrl === '') && !next.apiKey;
            if (!removing) {
                const effective = next.useGlobalConfig ? globalConfig : {
                    baseUrl: candidate.baseUrl,
                    apiKey: next.apiKey || decrypt(adminId, candidate.apiKeyEncrypted),
                };
                if (!effective.baseUrl || !effective.apiKey)
                    throw new WahaError('WAHA_INVALID_INPUT', 400, next.useGlobalConfig
                        ? 'Global WhatsApp configuration is incomplete. Ask the server operator to configure the WAHA URL and API key, or turn off global configuration.'
                        : 'Enter both a WAHA server URL and API key, or clear the URL or remove the saved key to disable WhatsApp.');
                await createWahaClient({ ...effective, sessionName: candidate.sessionName }, transportOptions).validateConnection(adminId);
            }
            const settings = await store.update(adminId, (previous) => {
                const latest = storedSchema.parse(previous ?? {});
                if (latest.baseUrl !== current.baseUrl || latest.apiKeyEncrypted !== current.apiKeyEncrypted
                    || latest.useGlobalConfig !== current.useGlobalConfig || latest.sessionName !== current.sessionName)
                    throw new WahaError('WAHA_CONFLICT', 409, 'WhatsApp settings changed while checking the connection. Reload settings and try again.');
                return candidate;
            });
            // Validation is read-only. Old sessions remain untouched.
            return publicSettings(adminId, settings);
        },
        async resolve(adminId: string): Promise<WahaSessionConfig> {
            let settings = storedSchema.parse(
                (await store.read(adminId)) ?? {},
            );
            if (!settings.useGlobalConfig && (!settings.baseUrl || !settings.apiKeyEncrypted))
                return { baseUrl: '', apiKey: '', sessionName: settings.sessionName };
            if (!settings.sessionName) {
                // The store locks the admin row, so concurrent first reads reuse one name.
                settings = await store.update(adminId, (previous) => {
                    const latest = storedSchema.parse(previous ?? {});
                    return { ...latest, sessionName: latest.sessionName || adminWhatsAppSessionName() };
                });
            }
            if (settings.useGlobalConfig) return { ...globalConfig, sessionName: settings.sessionName };
            if (!settings.baseUrl || !settings.apiKeyEncrypted)
                return { baseUrl: '', apiKey: '', sessionName: settings.sessionName };
            try {
                return { ...parseWahaConfig(
                    settings.baseUrl,
                    decrypt(adminId, settings.apiKeyEncrypted),
                ), sessionName: settings.sessionName };
            } catch {
                // Never retry or fall back to global configuration on private errors.
                throw new WahaError(
                    'WAHA_UNAVAILABLE',
                    503,
                    'WhatsApp private configuration cannot be used. Check your configuration or contact the server operator.',
                );
            }
        },
    };
}
