import { createHash, randomUUID } from 'node:crypto';
import { defaultWahaSafety, wahaSafetySchema, type WahaSafetySettings } from './wahaSafety';
import { adminWhatsAppBatchSchema, WahaError, type WhatsAppAccepted, type WhatsAppReceipt, type WahaSessionConfig } from './waha';

// Safety follows the persisted tenant/session, never an editable URL alias.
export function wahaSafetyKey(adminId: string, config: Pick<WahaSessionConfig, 'sessionName'>) {
    return createHash('sha256').update(JSON.stringify([adminId, config.sessionName])).digest('hex');
}
// Content is separately pinned to the exact endpoint AND credentials at enqueue.
export function wahaConfigIdentity(config: WahaSessionConfig) {
    return createHash('sha256').update(JSON.stringify([config.baseUrl, config.sessionName, config.apiKey])).digest('hex');
}

export type WhatsAppJob = {
    id: string; batchId: string; phone: string; text: string;
    status: 'queued' | 'processing' | 'accepted' | 'failed' | 'uncertain' | 'cancelled';
    createdAt: number; expiresAt: number; startedAt?: number; result?: string;
    requestHash: string;
    configIdentity: string;
    priority?: 'normal' | 'otp';
    reminder?: { activationId: string; activatedAt: number; expiresAt: number };
    preview?: string; previewExpiresAt?: number;
    messageId?: string; messageTimestamp?: number; sentAt?: number; ack?: number; receiptCheckedAt?: number; nextReceiptAt?: number;
};
export type WhatsAppOutboxState = {
    jobs: WhatsAppJob[]; nextAt: number; paused: boolean;
    windowStart: number; count: number;
    attempts: { phone: string; at: number }[];
    receiptsNextAt?: number;
    schedulingVersion?: 1;
};
export const emptyWhatsAppOutbox = (): WhatsAppOutboxState => ({
    jobs: [], nextAt: 0, paused: false, windowStart: 0, count: 0, attempts: [], schedulingVersion: 1,
});

export function migrateWhatsAppScheduling(state: WhatsAppOutboxState, time: number) {
    if (state.schedulingVersion === 1) return;
    // Old nextAt had no reason tag. Preserve all bounded readiness/session waits
    // and active claims; replace only longer legacy breaks with a short gap.
    if (!state.jobs.some((job) => job.status === 'processing') && state.nextAt > time + 180_000)
        state.nextAt = time + 60_000;
    state.schedulingVersion = 1;
}

export function applyWhatsAppReceipt(job: WhatsAppJob, receipt: WhatsAppReceipt) {
    if (job.messageId && job.messageId !== receipt.messageId) return;
    job.messageId = receipt.messageId;
    if (receipt.messageTimestamp !== undefined) job.messageTimestamp ??= receipt.messageTimestamp;
    if (receipt.sentAt !== undefined) job.sentAt ??= receipt.sentAt;
    // Later/stale server observations cannot downgrade delivery/read evidence.
    if (receipt.ack !== undefined && (job.ack === undefined || receipt.ack > job.ack
        || (receipt.ack === -1 && job.ack === 0))) job.ack = receipt.ack;
    if ((job.ack ?? 0) >= 1 && job.messageTimestamp !== undefined) job.sentAt ??= job.messageTimestamp;
}
export function invalidateWhatsAppConfiguration(state: WhatsAppOutboxState, currentIdentity: string | null) {
    for (const job of state.jobs) {
        if (job.configIdentity === currentIdentity) continue;
        if (job.status === 'queued') {
            job.status = 'cancelled'; job.text = ''; job.result = 'WhatsApp server or credentials changed. Queue a new message after checking the connection.';
        } else if (job.status === 'processing') {
            job.status = 'uncertain'; job.text = ''; job.result = 'WhatsApp configuration changed during processing. Check WhatsApp before sending again.';
        }
    }
}
export interface WhatsAppOutboxStore {
    change<T>(key: string, adminId: string, change: (state: WhatsAppOutboxState) => T): Promise<T>;
}

// All mutations must be serialized by a database row lock, not a process-local mutex.
export function createWhatsAppOutbox(store: WhatsAppOutboxStore, options: {
    configIdentity: (adminId: string) => Promise<string>;
    safety?: (adminId: string) => Promise<WahaSafetySettings>;
    now?: () => number; random?: () => number;
}) {
    const now = options.now ?? Date.now;
    const gap = (safety = defaultWahaSafety) => safety.minDelaySeconds * 1000
        + Math.floor((options.random ?? Math.random)() * ((safety.maxDelaySeconds - safety.minDelaySeconds) * 1000 + 1));
    const settle = (s: WhatsAppOutboxState) => {
        const time = now();
        migrateWhatsAppScheduling(s, time);
        s.attempts = s.attempts.filter((a) => a.at > time - 3_600_000);
        for (const job of s.jobs) {
            if (job.previewExpiresAt !== undefined && job.previewExpiresAt <= time) {
                delete job.preview; delete job.previewExpiresAt;
            }
            if (job.status === 'processing' && (job.startedAt ?? 0) < time - 180_000) {
                job.status = 'uncertain';
                job.result = 'Worker interrupted. Check WhatsApp before manually sending again; never automatically retried.';
                job.text = '';
                s.nextAt = Math.max(s.nextAt, time + gap());
            }
            if (job.status === 'queued' && job.expiresAt <= time) {
                job.status = 'cancelled'; job.text = ''; job.result = 'Expired before sending.';
            }
        }
    };
    return {
        async enqueue(key: string, adminId: string, input: unknown, lifetimeMs = 86_400_000, reminder?: WhatsAppJob['reminder'], priority: NonNullable<WhatsAppJob['priority']> = 'normal'): Promise<WhatsAppAccepted> {
            const parsed = adminWhatsAppBatchSchema.safeParse(input);
            if (!parsed.success) throw new WahaError('WAHA_INVALID_INPUT', 400, 'Provide 1-50 international recipients, 1-4096 text characters and a request ID.');
            const data = parsed.data;
            const configIdentity = await options.configIdentity(adminId);
            const phones = [...new Set(data.phones.map((p) => p.replace(/^\+/, '')))];
            const requestHash = createHash('sha256').update(JSON.stringify({ phones, text: data.text })).digest('hex');
            return store.change(key, adminId, (s) => {
                settle(s);
                const previous = s.jobs.filter((j) => j.batchId === data.requestId);
                if (previous.length) {
                    if (previous[0]?.requestHash !== requestHash) throw new WahaError('WAHA_CONFLICT', 409, 'This request ID was already used for different message content or recipients.');
                    return { ok: true, queued: true, batchId: data.requestId };
                }
                const capacity = priority === 'otp' ? 60 : 50;
                if (s.jobs.filter((j) => ['queued', 'processing'].includes(j.status)).length + phones.length > capacity)
                    throw new WahaError('WAHA_RATE_LIMITED', 429, `The WhatsApp queue is full (${capacity} recipients maximum). Wait for it to finish.`);
                // Bounded 24h admin preview; internal short-lived secrets never get a preview.
                s.jobs = s.jobs.filter((j) => ['queued', 'processing'].includes(j.status) || j.createdAt > now() - 86_400_000);
                if (s.jobs.length + phones.length > 500)
                    throw new WahaError('WAHA_RATE_LIMITED', 429, 'Daily WhatsApp outbox limit reached. Rest and try tomorrow.');
                for (const phone of phones) s.jobs.push({ id: randomUUID(), batchId: data.requestId, phone,
                    text: data.text, requestHash, configIdentity, priority, status: 'queued', createdAt: now(), expiresAt: Math.min(now() + lifetimeMs, reminder?.expiresAt ?? Infinity),
                    ...(reminder ? { reminder } : {}),
                    ...(priority !== 'otp' && lifetimeMs >= 86_400_000 ? { preview: data.text, previewExpiresAt: now() + 86_400_000 } : {}) });
                return { ok: true, queued: true, batchId: data.requestId };
            });
        },
        async view(key: string, adminId: string) {
            return store.change(key, adminId, (s) => {
                settle(s);
                return { paused: s.paused, nextAt: s.nextAt,
                    jobs: s.jobs.map(({ text: _text, requestHash: _hash, configIdentity: _config,
                        messageId: _id, messageTimestamp: _timestamp, nextReceiptAt: _next, previewExpiresAt: _expiry, ...job }) => job).slice(-100) };
            });
        },
        async cancel(key: string, adminId: string) {
            return store.change(key, adminId, (s) => {
                settle(s);
                for (const job of s.jobs) if (job.status === 'queued') {
                    job.status = 'cancelled'; job.text = ''; job.result = 'Cancelled by admin.';
                }
                return { ok: true as const };
            });
        },
        async guardSessionChange(key: string, adminId: string, cancelQueued: boolean) {
            return store.change(key, adminId, (s) => {
                settle(s);
                if (s.paused) throw new WahaError('WAHA_RESTRICTED', 409, 'WhatsApp sending is paused after a restriction. Do not restart, log out or re-pair. Contact the operator.');
                if (s.jobs.some((j) => j.status === 'processing')) throw new WahaError('WAHA_CONFLICT', 409, 'Wait for the current WhatsApp send to finish before changing the session.');
                for (const job of s.jobs) if (cancelQueued && job.status === 'queued') {
                    job.status = 'cancelled'; job.text = ''; job.result = 'Session was changed.';
                }
                // Reserve enough time for the bounded session management request,
                // including concurrent enqueue calls in other API processes.
                s.nextAt = Math.max(s.nextAt, now() + 60_000);
            });
        },
        async reconcile(key: string, adminId: string, read: (job: WhatsAppJob) => Promise<WhatsAppReceipt | undefined>) {
            const identity = await options.configIdentity(adminId);
            const jobs = await store.change(key, adminId, (s) => {
                settle(s);
                if ((s.receiptsNextAt ?? 0) > now()) return [];
                // Persist the shared budget before I/O, including across API workers.
                s.receiptsNextAt = now() + 60_000;
                if (s.paused) return [];
                const pending = s.jobs.filter((j) => j.status === 'accepted' && j.messageId && j.configIdentity === identity
                    && j.createdAt > now() - 86_400_000 && (j.ack ?? 0) < 3 && (j.nextReceiptAt ?? 0) <= now())
                    .sort((a, b) => (a.nextReceiptAt ?? 0) - (b.nextReceiptAt ?? 0)).slice(0, 3);
                for (const j of pending) j.nextReceiptAt = now() + 300_000;
                return pending.map((j) => ({ ...j, text: '', preview: undefined }));
            });
            for (const job of jobs) {
                let receipt: WhatsAppReceipt | undefined;
                let restricted = false;
                try {
                    if (await options.configIdentity(adminId) !== job.configIdentity) continue;
                    receipt = await read(job);
                } catch (error) {
                    restricted = error instanceof WahaError && error.code === 'WAHA_RESTRICTED';
                    // Unsupported APIs, offline sessions and missing messages are not send failures.
                }
                const currentIdentity = await options.configIdentity(adminId);
                await store.change(key, adminId, (s) => {
                    const current = s.jobs.find((j) => j.id === job.id);
                    if (!current || current.status !== 'accepted' || current.configIdentity !== currentIdentity) return;
                    s.paused ||= restricted;
                    current.receiptCheckedAt = now();
                    if (receipt && receipt.messageId === current.messageId) applyWhatsAppReceipt(current, receipt);
                    else current.nextReceiptAt = now() + 900_000;
                });
                if (restricted) break;
            }
        },
        async run(key: string, adminId: string, deliver: (job: WhatsAppJob, authorize: () => Promise<void>) => Promise<WhatsAppReceipt | void>) {
            const configIdentity = await options.configIdentity(adminId);
            const safety = wahaSafetySchema.parse(await options.safety?.(adminId) ?? defaultWahaSafety);
            const job = await store.change(key, adminId, (s) => {
                settle(s);
                invalidateWhatsAppConfiguration(s, configIdentity);
                const time = now();
                if (s.paused) { s.nextAt = Math.max(s.nextAt, time + 60_000); return null; }
                if (s.nextAt > time || s.jobs.some((j) => j.status === 'processing')) return null;
                const eligible = (j: WhatsAppJob) => j.status === 'queued'
                    && s.attempts.filter((a) => a.phone === j.phone).length < safety.perContactHourlyLimit;
                // Missing persisted priority is ordinary; preserve FIFO within each lane.
                const next = s.jobs.find((j) => j.priority === 'otp' && eligible(j)) ?? s.jobs.find(eligible);
                if (!next) {
                    s.nextAt = time + 60_000;
                    return null;
                }
                next.status = 'processing'; next.startedAt = time;
                s.windowStart ||= time; s.count++;
                s.attempts.push({ phone: next.phone, at: time });
                // A crashed worker cannot unlock this session for another send prematurely.
                s.nextAt = time + 180_000;
                return { ...next };
            });
            if (!job) return;
            let status: WhatsAppJob['status'] = 'accepted';
            let result = 'Accepted by WhatsApp service; delivery is not confirmed.';
            let restricted = false;
            let receipt: WhatsAppReceipt | void;
            try {
                receipt = await deliver(job, async () => {
                    if (await options.configIdentity(adminId) !== job.configIdentity)
                        throw new WahaError('WAHA_NOT_READY', 409, 'WhatsApp server or credentials changed before sending.');
                    return store.change(key, adminId, (s) => {
                    const current = s.jobs.find((j) => j.id === job.id);
                    if (s.paused || current?.status !== 'processing' || now() >= (job.startedAt ?? 0) + 150_000 || now() >= job.expiresAt)
                        throw new WahaError('WAHA_NOT_READY', 409, 'Outbox delivery claim expired or was paused.');
                    });
                });
            } catch (error) {
                restricted = error instanceof WahaError && error.code === 'WAHA_RESTRICTED';
                status = error instanceof WahaError && ['WAHA_NOT_READY', 'WAHA_RATE_LIMITED', 'WAHA_DISABLED', 'WAHA_RESTRICTED'].includes(error.code) ? 'failed' : 'uncertain';
                result = error instanceof WahaError ? error.message : 'Sending was not confirmed. Check WhatsApp before manually retrying.';
            }
            await store.change(key, adminId, (s) => {
                const current = s.jobs.find((j) => j.id === job.id);
                if (current?.status === 'processing') {
                    Object.assign(current, { status, result, text: '' });
                    if (status === 'accepted' && receipt) {
                        applyWhatsAppReceipt(current, receipt);
                        current.nextReceiptAt = now() + 60_000;
                    }
                }
                s.paused ||= restricted;
                s.nextAt = now() + gap(safety);
            });
        },
    };
}
