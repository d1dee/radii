import { randomBytes } from 'node:crypto';
import { z } from 'zod';

export interface WahaConfig {
    baseUrl: string;
    apiKey: string;
}
export type WahaSessionConfig = WahaConfig & { sessionName: string };

export function parseWahaConfig(baseUrl = '', apiKey = ''): WahaConfig {
    if (!baseUrl && !apiKey) return { baseUrl: '', apiKey: '' };
    // Never include input values in configuration errors (URLs can contain secrets).
    const invalid = () =>
        new Error(
            'WAHA_BASE_URL and WAHA_API_KEY must both be set; use an HTTP(S) origin without credentials, path, query or fragment and a non-empty API key without whitespace.',
        );
    let url: URL;
    try {
        url = new URL(baseUrl);
    } catch {
        throw invalid();
    }
    if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash ||
        !/^[\x21-\x7e]+$/.test(apiKey)
    )
        throw invalid();
    return { baseUrl: url.origin, apiKey };
}

export const adminWhatsAppTextSchema = z
    .object({
        phone: z.string().regex(/^\+?[1-9]\d{7,14}$/),
        text: z
            .string()
            .min(1)
            .max(4096)
            .refine((text) => text.trim().length > 0 && !text.includes('\0')),
    })
    .strict();
export type AdminWhatsAppTextInput = z.infer<typeof adminWhatsAppTextSchema>;
export const adminWhatsAppBatchSchema = z.object({
    phones: z.array(adminWhatsAppTextSchema.shape.phone).min(1).max(50),
    text: adminWhatsAppTextSchema.shape.text,
    requestId: z.uuid(),
}).strict();
export type WhatsAppAccepted = { ok: true; queued: true; batchId: string };
export type WhatsAppReceipt = { messageId: string; messageTimestamp?: number; sentAt?: number; ack?: number };

// Only normalized public fields, never engine-specific _data or message bodies.
export function parseWhatsAppReceipt(value: unknown, phone: string, expectedId?: string): WhatsAppReceipt | undefined {
    const parsed = z.object({ id: z.string().min(1).max(512), fromMe: z.literal(true),
        to: z.string(), timestamp: z.number().finite().positive().optional(),
        ack: z.number().int().min(-1).max(4).optional() }).safeParse(value);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.to.replace(/@s\.whatsapp\.net$/, '@c.us') !== `${phone.replace(/^\+/, '')}@c.us`
        || (expectedId !== undefined && message.id !== expectedId)) return;
    const timestamp = message.timestamp === undefined ? undefined : message.timestamp * 1000;
    return { messageId: message.id, ...(timestamp && timestamp < 8_640_000_000_000_000
        ? { messageTimestamp: timestamp, ...((message.ack ?? 0) >= 1 ? { sentAt: timestamp } : {}) } : {}),
        ...(message.ack === undefined ? {} : { ack: message.ack }) };
}

const sessionStatusSchema = z.enum([
    'STOPPED',
    'STARTING',
    'SCAN_QR_CODE',
    'WORKING',
    'FAILED',
    'PASSKEY_REQUIRED',
    'PASSKEY_CONFIRMATION_REQUIRED',
]);
export type AdminWhatsAppStatus = {
    configured: boolean;
    status: z.infer<typeof sessionStatusSchema> | 'NOT_CREATED' | 'DISABLED';
};
export interface AdminWhatsAppQr {
    mimetype: 'image/png';
    data: string;
}
export type WahaErrorCode =
    | 'WAHA_DISABLED'
    | 'WAHA_UNAVAILABLE'
    | 'WAHA_TIMEOUT'
    | 'WAHA_NOT_FOUND'
    | 'WAHA_CONFLICT'
    | 'WAHA_NOT_READY'
    | 'WAHA_INVALID_INPUT'
    | 'WAHA_RATE_LIMITED'
    | 'WAHA_RESTRICTED';

export class WahaError extends Error {
    constructor(
        public readonly code: WahaErrorCode,
        public readonly status: 400 | 404 | 409 | 429 | 502 | 503 | 504,
        message: string,
        public readonly retryAfter?: number,
    ) {
        super(message);
        this.name = 'WahaError';
    }
}

export function adminWhatsAppSessionName(): string {
    return `radii_admin_${randomBytes(6).toString('base64url')}`;
}

type Transport = (url: string, init: RequestInit) => Promise<Response>;

// Injectable transport keeps all tests offline. No retries: a failed send may
// already have reached WhatsApp, so retrying could deliver duplicate messages.
export function createWahaClient(
    source: WahaSessionConfig | ((adminId: string) => Promise<WahaSessionConfig>),
    options: {
        fetch?: Transport;
        timeoutMs?: number;
        now?: () => number;
        random?: () => number;
        wait?: (ms: number) => Promise<void>;
        enqueue?: (adminId: string, phone: string, text: string) => Promise<WhatsAppAccepted>;
        authorizeDelivery?: (adminId: string, phone: string, text: string) => Promise<void>;
        authorizeSessionChange?: (adminId: string, action: 'create' | 'start' | 'restart' | 'logout' | 'delete') => Promise<void>;
    } = {},
) {
    const transport = options.fetch ?? ((url, init) => fetch(url, init));
    const now = options.now ?? Date.now;
    const buckets = new Map<string, { count: number; resetAt: number }>();
    const resolveConfig = (adminId: string) =>
        typeof source === 'function' ? source(adminId) : source;
    function limit(adminId: string, tier: 'read' | 'manage' | 'send') {
        if (!adminId || adminId.length > 256)
            throw new WahaError('WAHA_INVALID_INPUT', 400, 'Invalid admin identity.');
        const key = `${adminId}:${tier}`;
        const time = now();
        let bucket = buckets.get(key);
        if (!bucket || bucket.resetAt <= time) {
            for (const [oldKey, old] of buckets)
                if (old.resetAt <= time) buckets.delete(oldKey);
            if (buckets.size >= 20_000)
                throw new WahaError(
                    'WAHA_RATE_LIMITED',
                    429,
                    'WhatsApp request limit reached. Retry later.',
                    60,
                );
            bucket = { count: 0, resetAt: time + 60_000 };
            buckets.set(key, bucket);
        }
        if (++bucket.count > (tier === 'read' ? 60 : 10)) {
            throw new WahaError(
                'WAHA_RATE_LIMITED',
                429,
                'Too many WhatsApp requests. Retry later.',
                Math.max(1, Math.ceil((bucket.resetAt - time) / 1000)),
            );
        }
    }
    async function readJson(
        response: Response,
        maxBytes: number,
    ): Promise<unknown> {
        const reader = response.body?.getReader();
        if (!reader) throw new Error('Empty WAHA response');
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                size += value.byteLength;
                if (size > maxBytes) {
                    await reader.cancel();
                    throw new Error('WAHA response exceeds size limit');
                }
                chunks.push(value);
            }
        } finally {
            reader.releaseLock();
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }
    async function request(
        config: WahaConfig,
        path: string,
        method = 'GET',
        body?: unknown,
        json = true,
        validationName?: string,
    ): Promise<unknown> {
        if (!config.baseUrl || !config.apiKey)
            throw new WahaError(
                'WAHA_DISABLED',
                503,
                'WhatsApp integration is not configured.',
            );
        const signal = AbortSignal.timeout(options.timeoutMs ?? 10_000);
        try {
            const response = await transport(`${config.baseUrl}${path}`, {
                method,
                signal,
                redirect: 'error',
                cache: 'no-store',
                headers: {
                    'X-Api-Key': config.apiKey,
                    Accept: 'application/json',
                    ...(body === undefined
                        ? {}
                        : { 'Content-Type': 'application/json' }),
                },
                body: body === undefined ? undefined : JSON.stringify(body),
            });
            // Inspect bounded error JSON, but never expose arbitrary upstream text.
            const errorBody = response.ok
                ? null
                : await readJson(response, 16_384).catch(() => null);
            if (!response.ok && (response.status === 463 || response.status === 475 ||
                /(?:error|code|status)[^\d]{0,30}(?:463|475)\b/i.test(JSON.stringify(errorBody)))) {
                throw new WahaError('WAHA_RESTRICTED', 409,
                    'WhatsApp has restricted messaging (463/475). Sending is paused. Do not restart, log out or re-pair; wait for the restriction to lift and contact the operator.');
            }

            const details = z
                .object({
                    message: z
                        .union([z.string(), z.array(z.string())])
                        .optional(),
                    error: z.string().optional(),
                    status: sessionStatusSchema.optional(),
                    expected: z.array(sessionStatusSchema).optional(),
                })
                .safeParse(errorBody);

            const diagnostic = details.success
                ? [details.data.message, details.data.error]
                      .flat()
                      .filter(Boolean)
                      .join(' ')
                : '';

            const sessionMessage =
                /only[^\n]*['"]?default|['"]?default['"]?[^\n]*only|multiple sessions[^\n]*plus/i.test(
                    diagnostic,
                )
                    ? 'This WAHA server only supports the default session. Admin-isolated WhatsApp connections require WAHA Plus with named-session support.'
                    : /session status is not as expected/i.test(diagnostic) &&
                        details.success &&
                        details.data.status
                      ? `WAHA session is ${details.data.status}.${details.data.expected?.length ? ` Expected ${details.data.expected.join(' or ')}.` : ''} Refresh its status or restart the connection.`
                      : /session[^\n]*already exists/i.test(diagnostic)
                        ? 'This WAHA session already exists. Refresh its status and start or restart the existing connection.'
                        : undefined;

            if (validationName && !response.ok && response.status !== 404) {
                const message =
                    response.status === 401
                        ? 'WAHA rejected the API key. Check the key and try again.'
                        : response.status === 403
                          ? 'WAHA denied access to this admin session. Check the API key permissions and session scope.'
                          : sessionMessage
                            ? sessionMessage
                            : response.status >= 500
                              ? 'The WAHA server reported an error. Check the service and try again.'
                              : response.status === 429
                                ? 'WAHA is limiting requests. Wait a moment and try again.'
                                : response.status >= 300 &&
                                    response.status < 400
                                  ? 'The WAHA URL redirects elsewhere. Enter the final WAHA server origin.'
                                  : 'WAHA could not read this named session. Check the URL, API key scope and support for multiple named sessions.';
                throw new WahaError('WAHA_UNAVAILABLE', 502, message);
            }

            if (!response.ok && !(validationName && response.status === 404)) {
                if (response.status === 401 || response.status === 403)
                    throw new WahaError(
                        'WAHA_UNAVAILABLE',
                        502,
                        response.status === 401
                            ? 'WAHA rejected the API key. Check the key and try again.'
                            : 'WAHA denied access to this admin session. Check the API key permissions and session scope.',
                    );

                if (response.status === 404)
                    throw new WahaError(
                        'WAHA_NOT_FOUND',
                        404,
                        'WhatsApp session not found.',
                    );
                if ([409, 422].includes(response.status))
                    throw new WahaError(
                        'WAHA_CONFLICT',
                        409,
                        sessionMessage ??
                            'WhatsApp session cannot perform this operation. Check its status and that WAHA supports multiple named sessions.',
                    );
                throw new WahaError(
                    'WAHA_UNAVAILABLE',
                    502,
                    sessionMessage ??
                        'WhatsApp service is unavailable. Check server configuration and multi-session support.',
                );
            }
            if (!json) {
                await response.body?.cancel();
                return undefined;
            }
            const data = response.ok
                ? await readJson(response, 512_000).catch((error) => {
                    // A successful send with no usable metadata is still accepted.
                    // Never turn missing receipt support into another send attempt.
                    if (path === '/api/sendText') return undefined;
                    throw error;
                })
                : errorBody;
            if (validationName && response.status === 404) {
                // A generic proxy/router 404 does not prove this is a WAHA endpoint.
                const missing = z
                    .object({
                        statusCode: z.literal(404),
                        error: z.literal('Not Found'),
                        message: z.literal('Session not found'),
                    })
                    .safeParse(data);
                if (missing.success) return undefined;
                throw new WahaError(
                    'WAHA_UNAVAILABLE',
                    502,
                    'The URL did not return a recognizable WAHA session response. Check the server URL and named-session support.',
                );
            }
            return data;
        } catch (error) {
            if (error instanceof WahaError) throw error;
            if (signal.aborted)
                throw new WahaError(
                    'WAHA_TIMEOUT',
                    504,
                    'WhatsApp service request timed out.',
                );
            if (validationName) {
                // Inspect only to classify; never expose transport messages, URLs or bodies.
                const details: string[] = [];
                let cause: unknown = error;
                for (
                    let depth = 0;
                    depth < 4 && cause && typeof cause === 'object';
                    depth++
                ) {
                    const item = cause as {
                        code?: unknown;
                        message?: unknown;
                        cause?: unknown;
                    };
                    details.push(
                        String(item.code ?? ''),
                        String(item.message ?? ''),
                    );
                    cause = item.cause;
                }
                const diagnostic = details.join(' ');
                const message =
                    /ALTNAME|HOSTNAME|hostname.*(match|mismatch)/i.test(
                        diagnostic,
                    )
                        ? 'The WAHA HTTPS certificate does not match the server hostname. Ask the server operator to fix the certificate or URL.'
                        : /CERT_HAS_EXPIRED|certificate.*expired/i.test(
                                diagnostic,
                            )
                          ? 'The WAHA HTTPS certificate has expired. Ask the server operator to renew it.'
                          : /CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY|LOCAL_ISSUER/i.test(
                                  diagnostic,
                              )
                            ? 'The WAHA HTTPS certificate could not be verified. Ask the server operator to install a valid certificate and complete certificate chain.'
                            : /ENOTFOUND|EAI_AGAIN|DNS/i.test(diagnostic)
                              ? 'The WAHA server hostname could not be resolved. Check the URL and server DNS.'
                              : /ECONNREFUSED/i.test(diagnostic)
                                ? 'The WAHA server refused the connection. Check the server port and that WAHA is running.'
                                : /TIMEOUT|TIMEDOUT/i.test(diagnostic)
                                  ? 'The WAHA connection timed out. Check server connectivity and try again.'
                                  : /ENETUNREACH|EHOSTUNREACH|ECONNRESET|connection.*closed|fetch failed|failed to fetch|unable to connect/i.test(
                                          diagnostic,
                                      )
                                    ? 'The WAHA server could not be reached. Check the URL, network and firewall.'
                                    : 'The server did not return a valid WAHA session response. Check that the URL points to WAHA.';
                throw new WahaError('WAHA_UNAVAILABLE', 502, message);
            }
            throw new WahaError(
                'WAHA_UNAVAILABLE',
                502,
                'WhatsApp service returned an invalid response or is unavailable.',
            );
        }
    }
    async function status(
        config: WahaConfig,
        name: string,
    ): Promise<AdminWhatsAppStatus> {
        if (!config.baseUrl || !config.apiKey)
            return { configured: false, status: 'DISABLED' };
        try {
            const parsed = z
                .object({ name: z.literal(name), status: sessionStatusSchema })
                .safeParse(await request(config, `/api/sessions/${name}`));
            if (!parsed.success)
                throw new WahaError(
                    'WAHA_UNAVAILABLE',
                    502,
                    'WhatsApp service returned an invalid session.',
                );
            return { configured: true, status: parsed.data.status };
        } catch (error) {
            if (error instanceof WahaError && error.code === 'WAHA_NOT_FOUND')
                return { configured: true, status: 'NOT_CREATED' };
            throw error;
        }
    }
    return {
        async validateConnection(adminId: string): Promise<void> {
            const config = await resolveConfig(adminId);
            const name = config.sessionName;
            const data = await request(
                config,
                `/api/sessions/${name}`,
                'GET',
                undefined,
                true,
                name,
            );
            if (
                data !== undefined &&
                !z
                    .object({
                        name: z.literal(name),
                        status: sessionStatusSchema,
                    })
                    .safeParse(data).success
            )
                throw new WahaError(
                    'WAHA_UNAVAILABLE',
                    502,
                    'The server did not return a valid WAHA session response. Check that the URL points to WAHA.',
                );
        },
        async getStatus(adminId: string) {
            limit(adminId, 'read');
            const config = await resolveConfig(adminId);
            return status(config, config.sessionName);
        },
        async createSession(adminId: string): Promise<{ ok: true }> {
            limit(adminId, 'manage');
            await options.authorizeSessionChange?.(adminId, 'create');
            const config = await resolveConfig(adminId);
            const name = config.sessionName;
            const current = await status(config, name);
            if (!current.configured) {
                throw new WahaError(
                    'WAHA_DISABLED',
                    503,
                    'WhatsApp integration is not configured.',
                );
            }
            if (current.status === 'NOT_CREATED') {
                await request(
                    config,
                    '/api/sessions',
                    'POST',
                    {
                        name,
                        start: true,
                        config: { metadata: { 'radii.adminId': adminId }, noweb: { store: { enabled: true, fullSync: false } } },
                    },
                    false,
                );
            } else if (
                current.status === 'STOPPED' ||
                current.status === 'FAILED'
            ) {
                await request(
                    config,
                    `/api/sessions/${name}/${current.status === 'FAILED' ? 'restart' : 'start'}`,
                    'POST',
                    undefined,
                    false,
                );
            }
            return { ok: true };
        },
        async sessionAction(
            adminId: string,
            action: 'start' | 'restart' | 'logout' | 'delete',
        ): Promise<{ ok: true }> {
            limit(adminId, 'manage');
            // Runtime allowlist as well as static types: never accept an arbitrary path.
            if (!['start', 'restart', 'logout', 'delete'].includes(action))
                throw new WahaError(
                    'WAHA_INVALID_INPUT',
                    400,
                    'Invalid WhatsApp session action.',
                );
            await options.authorizeSessionChange?.(adminId, action);
            const config = await resolveConfig(adminId);
            const name = config.sessionName;
            try {
                await request(
                    config,
                    `/api/sessions/${name}${action === 'delete' ? '' : `/${action}`}`,
                    action === 'delete' ? 'DELETE' : 'POST',
                    undefined,
                    false,
                );
            } catch (error) {
                if (
                    !(
                        action === 'delete' &&
                        error instanceof WahaError &&
                        error.code === 'WAHA_NOT_FOUND'
                    )
                )
                    throw error;
            }
            return { ok: true };
        },
        async getQr(adminId: string): Promise<AdminWhatsAppQr> {
            limit(adminId, 'read');
            const config = await resolveConfig(adminId);
            const name = config.sessionName;
            const current = await status(config, name);
            if (!current.configured)
                throw new WahaError(
                    'WAHA_DISABLED',
                    503,
                    'WhatsApp integration is not configured.',
                );
            // Some engines expose a QR before their status leaves STARTING.
            if (!['STARTING', 'SCAN_QR_CODE'].includes(current.status))
                throw new WahaError(
                    'WAHA_NOT_READY',
                    409,
                    'WhatsApp session is not waiting for QR pairing.',
                );
            let image: unknown;
            try {
                image = await request(config, `/api/${name}/auth/qr?format=image`);
            } catch (error) {
                // Pairing may complete or expire between the status and QR reads.
                if (
                    error instanceof WahaError &&
                    ['WAHA_CONFLICT', 'WAHA_NOT_FOUND'].includes(error.code)
                )
                    throw new WahaError(
                        'WAHA_NOT_READY',
                        409,
                        'The WhatsApp pairing state changed. Refresh the connection status.',
                    );
                throw error;
            }
            const parsed = z
                .object({
                    mimetype: z.literal('image/png'),
                    data: z
                        .string()
                        .min(4)
                        .max(500_000)
                        .regex(
                            /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
                        ),
                })
                .safeParse(image);
            if (!parsed.success)
                throw new WahaError(
                    'WAHA_UNAVAILABLE',
                    502,
                    'WhatsApp service returned an invalid QR image.',
                );
            return { mimetype: parsed.data.mimetype, data: parsed.data.data };
        },
        async sendText(
            adminId: string,
            phone: string,
            text: string,
        ): Promise<WhatsAppAccepted> {
            const parsed = adminWhatsAppTextSchema.safeParse({ phone, text });
            if (!parsed.success)
                throw new WahaError(
                    'WAHA_INVALID_INPUT',
                    400,
                    'Provide an international phone number (8-15 digits, optional +) and 1-4096 characters of text.',
                );
            limit(adminId, 'send');
            if (!options.enqueue) throw new WahaError('WAHA_NOT_READY', 503, 'The safe WhatsApp outbox is not configured.');
            return options.enqueue(adminId, parsed.data.phone, parsed.data.text);
        },
        async getMessageReceipt(adminId: string, phone: string, messageId: string): Promise<WhatsAppReceipt | undefined> {
            limit(adminId, 'read');
            if (!/^\d{8,15}$/.test(phone) || !messageId || messageId.length > 512) return;
            const config = await resolveConfig(adminId);
            const path = `/api/${encodeURIComponent(config.sessionName)}/chats/${encodeURIComponent(`${phone}@c.us`)}/messages/${encodeURIComponent(messageId)}?downloadMedia=false`;
            return parseWhatsAppReceipt(await request(config, path), phone, messageId);
        },
        // Worker-only delivery. A durable claim is checked again immediately before text submission.
        async deliverMessage(adminId: string, phone: string, text: string): Promise<WhatsAppReceipt | undefined> {
            adminWhatsAppTextSchema.parse({ phone, text });
            if (!options.authorizeDelivery) throw new WahaError('WAHA_NOT_READY', 503, 'WhatsApp delivery requires a durable outbox claim.');
            await options.authorizeDelivery(adminId, phone, text);
            const config = await resolveConfig(adminId);
            const name = config.sessionName;
            const current = await status(config, name);
            if (!current.configured)
                throw new WahaError(
                    'WAHA_DISABLED',
                    503,
                    'WhatsApp integration is not configured.',
                );
            if (current.status !== 'WORKING')
                throw new WahaError(
                    'WAHA_NOT_READY',
                    409,
                    'Pair and start your WhatsApp session before sending messages.',
                );
            const chatId = `${phone.replace(/^\+/, '')}@c.us`;
            const presence = { session: name, chatId };
            await request(config, '/api/sendSeen', 'POST', presence, false);
            await request(config, '/api/startTyping', 'POST', presence, false);
            try {
                const typingMs = Math.min(20_000, 1000 + text.length * (35 + (options.random ?? Math.random)() * 45));
                await (options.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(typingMs);
            } finally {
                await request(config, '/api/stopTyping', 'POST', presence, false);
            }
            await options.authorizeDelivery(adminId, phone, text);
            const response = await request(
                config,
                '/api/sendText',
                'POST',
                {
                    session: name,
                    chatId,
                    text,
                    linkPreview: false,
                },
                true,
            );
            return parseWhatsAppReceipt(response, phone);
        },
    };
}
