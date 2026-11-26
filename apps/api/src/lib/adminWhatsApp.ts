import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { adminSetting, whatsappOutbox } from '../db/schema';
import { env } from '../env';
import { apiLogger } from '../logging';
import { createWahaClient, WahaError, type WhatsAppAccepted, type WahaSessionConfig } from './waha';
import { createWahaSettingsService } from './wahaSettings';
import { createWhatsAppOutbox, emptyWhatsAppOutbox, invalidateWhatsAppConfiguration, migrateWhatsAppScheduling, wahaSafetyKey, wahaConfigIdentity, type WhatsAppJob, type WhatsAppOutboxStore } from './wahaOutbox';
import { createPppoeExpiryReminderScheduler, isPppoeReminderCurrent } from './pppoeExpiryReminders';

// Older Bun SQL writes could persist the document as a JSON string.
const settingsDocument = sql`(case when jsonb_typeof(${adminSetting.settings}) = 'string' then (${adminSetting.settings} #>> '{}')::jsonb else ${adminSetting.settings} end)`;

export const adminWhatsAppSettings = createWahaSettingsService(
    {
        async read(adminId) {
            const [row] = await db
                .select({
                    config: sql`${settingsDocument}->'whatsapp'`.mapWith(
                        adminSetting.settings,
                    ),
                })
                .from(adminSetting)
                .where(eq(adminSetting.adminUserId, adminId))
                .limit(1);
            return row?.config;
        },
        async update(adminId, change) {
            return db.transaction(async (tx) => {
                await tx
                    .insert(adminSetting)
                    .values({ adminUserId: adminId })
                    .onConflictDoNothing();
                const [row] = await tx
                    .select({
                        config: sql`${settingsDocument}->'whatsapp'`.mapWith(
                            adminSetting.settings,
                        ),
                    })
                    .from(adminSetting)
                    .where(eq(adminSetting.adminUserId, adminId))
                    .for('update');
                const config = change(row?.config);
                const previous = row?.config as Record<string, unknown> | undefined;
                if ((['baseUrl', 'apiKeyEncrypted', 'useGlobalConfig', 'sessionName'] as const).some((field) => previous?.[field] !== config[field])) {
                    // Retain safety counters/restrictions/idempotency, but never carry
                    // queued content through a settings edit, even A -> B -> A.
                    const queues = await tx.select().from(whatsappOutbox).where(eq(whatsappOutbox.adminId, adminId)).for('update');
                    for (const queue of queues) {
                        invalidateWhatsAppConfiguration(queue.state, null);
                        await tx.update(whatsappOutbox).set({ state: sql`${JSON.stringify(queue.state)}::text::jsonb` }).where(eq(whatsappOutbox.sessionKey, queue.sessionKey));
                    }
                }
                await tx
                    .update(adminSetting)
                    .set({
                        // Bind serialized JSON as text so Bun SQL does not encode it twice.
                        settings: sql`jsonb_set(${settingsDocument}, '{whatsapp}', ${JSON.stringify(config)}::text::jsonb)`,
                    })
                    .where(eq(adminSetting.adminUserId, adminId));
                return config;
            });
        },
    },
    env.waha,
    env.wahaSettingsEncryptionKey,
);

// For callers already in a transaction, including atomic reminder+queue writes.
export function createTransactionalWhatsAppOutboxStore(tx: Pick<typeof db, 'insert' | 'select' | 'update'>): WhatsAppOutboxStore {
    return {
        async change(key, adminId, change) {
            await tx.insert(whatsappOutbox).values({ sessionKey: key, adminId,
                state: sql`${JSON.stringify(emptyWhatsAppOutbox())}::text::jsonb` }).onConflictDoNothing();
            const [row] = await tx.select().from(whatsappOutbox).where(eq(whatsappOutbox.sessionKey, key)).for('update');
            if (!row || row.adminId !== adminId) throw new WahaError('WAHA_CONFLICT', 409, 'This WhatsApp session belongs to another admin.');
            const result = change(row.state);
            await tx.update(whatsappOutbox).set({ state: sql`${JSON.stringify(row.state)}::text::jsonb` }).where(eq(whatsappOutbox.sessionKey, key));
            return result;
        },
    };
}
export function createPostgresWhatsAppOutboxStore(database: typeof db): WhatsAppOutboxStore {
    return { change: (key, adminId, change) => database.transaction((tx) =>
        createTransactionalWhatsAppOutboxStore(tx).change(key, adminId, change)) };
}
const outboxStore = createPostgresWhatsAppOutboxStore(db);
const outbox = createWhatsAppOutbox(outboxStore, {
    configIdentity: async (adminId) => wahaConfigIdentity(await configuredSession(adminId)),
    safety: async (adminId) => (await adminWhatsAppSettings.get(adminId)).safety,
});

async function configuredSession(adminId: string) {
    const config = await adminWhatsAppSettings.resolve(adminId);
    if (!config.baseUrl || !config.apiKey) throw new WahaError('WAHA_DISABLED', 503, 'WhatsApp integration is not configured.');
    return config;
}

export async function enqueueAdminWhatsApp(adminId: string, input: unknown, lifetimeMs?: number, priority: NonNullable<WhatsAppJob['priority']> = 'normal') {
    const config = await configuredSession(adminId);
    return outbox.enqueue(wahaSafetyKey(adminId, config), adminId, input, lifetimeMs, undefined, priority);
}

export async function getAdminWhatsAppOutbox(adminId: string) {
    // Safety and results remain attached to the persisted tenant/session identity.
    const rows = await db.select().from(whatsappOutbox).where(eq(whatsappOutbox.adminId, adminId));
    const views = await Promise.all(rows.map((r) => outbox.view(r.sessionKey, adminId)));
    return { paused: views.some((v) => v.paused), nextAt: Math.max(0, ...views.map((v) => v.nextAt)),
        jobs: views.flatMap((v) => v.jobs).sort((a, b) => b.createdAt - a.createdAt).slice(0, 100) };
}

export async function cancelAdminWhatsAppOutbox(adminId: string) {
    const rows = await db.select().from(whatsappOutbox).where(eq(whatsappOutbox.adminId, adminId));
    await Promise.all(rows.map((r) => outbox.cancel(r.sessionKey, adminId)));
    return { ok: true as const };
}

export const adminWhatsApp = createWahaClient((adminId) => adminWhatsAppSettings.resolve(adminId), {
    enqueue: (adminId, phone, text) => enqueueAdminWhatsApp(adminId,
        { phones: [phone], text, requestId: randomUUID() }, 240_000),
    authorizeSessionChange: async (adminId, action) => {
        const config = await configuredSession(adminId);
        await outbox.guardSessionChange(wahaSafetyKey(adminId, config), adminId, action === 'logout' || action === 'delete');
    },
});

const otpWhatsApp = createWahaClient((adminId) => adminWhatsAppSettings.resolve(adminId), {
    enqueue: (adminId, phone, text) => enqueueAdminWhatsApp(adminId,
        { phones: [phone], text, requestId: randomUUID() }, 240_000, 'otp'),
});

// Probe before claiming content: an unavailable connection is not a send attempt.
// Delivery still rechecks readiness and all anti-blocking rules after the claim.
export async function isWhatsAppOutboxReady(
    store: WhatsAppOutboxStore, key: string, adminId: string, config: WahaSessionConfig,
    getStatus = () => createWahaClient(config).getStatus(adminId), now = Date.now,
) {
    const pending = await store.change(key, adminId, (state) => {
        migrateWhatsAppScheduling(state, now());
        invalidateWhatsAppConfiguration(state, wahaConfigIdentity(config));
        for (const job of state.jobs) if (job.status === 'queued' && job.expiresAt <= now()) {
            job.status = 'cancelled'; job.text = ''; job.result = 'Expired before sending.';
        }
        if (state.paused) state.nextAt = Math.max(state.nextAt, now() + 60_000);
        return !state.paused && state.nextAt <= now() &&
            !state.jobs.some((job) => job.status === 'processing') &&
            state.jobs.some((job) => job.status === 'queued');
    });
    if (!pending) return false;
    let restricted = false;
    try {
        const status = await getStatus();
        if (status.configured && status.status === 'WORKING') return true;
    } catch (error) {
        restricted = error instanceof WahaError && error.code === 'WAHA_RESTRICTED';
    }
    await store.change(key, adminId, (state) => {
        state.paused ||= restricted;
        state.nextAt = Math.max(state.nextAt, now() + 60_000);
    });
    return false;
}

// Explicit application lifecycle, never an on-import task. Claims and pacing are
// persisted before network I/O so multiple API processes cannot race a session.
export function startWhatsAppOutboxWorker() {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active: Promise<void> = Promise.resolve();
    let warnedAt = 0;
    const warn = () => {
        if (Date.now() - warnedAt < 60_000) return;
        warnedAt = Date.now();
        apiLogger.getChild('whatsapp-outbox').warn('WhatsApp outbox processing could not complete. Check database migrations and configuration; interrupted sends are never automatically retried.');
    };
    const tick = async () => {
        try {
            const rows = await db.select().from(whatsappOutbox).where(and(
                sql`exists (select 1 from jsonb_array_elements(${whatsappOutbox.state}->'jobs') j where j->>'status' in ('queued', 'processing'))`,
                // Legacy breaks must migrate before their obsolete nextAt is due.
                sql`((${whatsappOutbox.state}->>'schedulingVersion') is null or (${whatsappOutbox.state}->>'nextAt')::bigint <= ${Date.now()} or exists
                    (select 1 from jsonb_array_elements(${whatsappOutbox.state}->'jobs') j where
                    (j->>'status' = 'queued' and (j->>'expiresAt')::bigint <= ${Date.now()}) or
                    (j->>'status' = 'processing' and coalesce((j->>'startedAt')::bigint, 0) < ${Date.now() - 180_000})))`,
            )).orderBy(sql`(${whatsappOutbox.state}->>'nextAt')::bigint`).limit(4);
            const results = await Promise.allSettled(rows.map(async (row) => {
                // Settle expired jobs and interrupted claims even when settings or
                // the transport cannot currently be resolved.
                await outbox.view(row.sessionKey, row.adminId);
                let config: WahaSessionConfig;
                try {
                    config = await adminWhatsAppSettings.resolve(row.adminId);
                } catch {
                    // One broken tenant configuration must not starve other sessions.
                    await outboxStore.change(row.sessionKey, row.adminId, (s) => {
                        s.nextAt = Math.max(s.nextAt, Date.now() + 60_000);
                    });
                    warn(); return;
                }
                if (wahaSafetyKey(row.adminId, config) !== row.sessionKey) {
                    await outbox.cancel(row.sessionKey, row.adminId); return;
                }
                if (!await isWhatsAppOutboxReady(outboxStore, row.sessionKey, row.adminId, config)) return;
                await outbox.run(row.sessionKey, row.adminId, async (job, authorize) => {
                    if (wahaConfigIdentity(config) !== job.configIdentity)
                        throw new WahaError('WAHA_NOT_READY', 409, 'WhatsApp configuration changed before processing.');
                    const client = createWahaClient(config, {
                        authorizeDelivery: async () => {
                            if (stopped || wahaConfigIdentity(await configuredSession(row.adminId)) !== job.configIdentity)
                                throw new WahaError('WAHA_NOT_READY', 409, 'WhatsApp configuration changed or worker stopped before sending.');
                            if (job.reminder && !await isPppoeReminderCurrent(db, row.adminId, job))
                                throw new WahaError('WAHA_NOT_READY', 409, 'Subscription reminder is no longer applicable.');
                            await authorize();
                        },
                    });
                    return client.deliverMessage(row.adminId, job.phone, job.text);
                });
            }));
            if (results.some((r) => r.status === 'rejected')) warn();
            // Completed jobs still need receipts. This separate bounded lane cannot
            // starve sends, and the persisted per-session budget survives restarts.
            const receiptRows = await db.select().from(whatsappOutbox).where(and(
                sql`coalesce((${whatsappOutbox.state}->>'receiptsNextAt')::bigint, 0) <= ${Date.now()}`,
                sql`exists (select 1 from jsonb_array_elements(${whatsappOutbox.state}->'jobs') j where
                    (j->>'previewExpiresAt')::bigint <= ${Date.now()} or
                    (j->>'status' = 'accepted' and j->>'messageId' is not null
                    and (j->>'createdAt')::bigint > ${Date.now() - 86_400_000}
                    and coalesce((j->>'ack')::int, 0) < 3
                    and coalesce((j->>'nextReceiptAt')::bigint, 0) <= ${Date.now()}))`,
            )).orderBy(sql`coalesce((${whatsappOutbox.state}->>'receiptsNextAt')::bigint, 0)`).limit(2);
            await Promise.allSettled(receiptRows.map(async (row) => {
                await outbox.view(row.sessionKey, row.adminId);
                let config: WahaSessionConfig;
                try { config = await configuredSession(row.adminId); }
                catch {
                    await outboxStore.change(row.sessionKey, row.adminId, (s) => { s.receiptsNextAt = Date.now() + 900_000; });
                    return;
                }
                if (wahaSafetyKey(row.adminId, config) !== row.sessionKey) {
                    await outboxStore.change(row.sessionKey, row.adminId, (s) => { s.receiptsNextAt = Date.now() + 900_000; });
                    return;
                }
                const client = createWahaClient(config);
                await outbox.reconcile(row.sessionKey, row.adminId,
                    (job) => client.getMessageReceipt(row.adminId, job.phone, job.messageId!));
            }));
        } catch {
            // Do not log upstream/config errors or message content. Next tick recovers
            // durable stale claims as uncertain, never as a fresh send attempt.
            warn();
        } finally {
            if (!stopped) timer = setTimeout(() => { active = tick(); }, 5000);
        }
    };
    active = tick();
    return async () => { stopped = true; clearTimeout(timer); await active; };
}

export function startPppoeExpiryReminderWorker() {
    const scheduler = createPppoeExpiryReminderScheduler(db, {
        enqueue: async (tx, adminId, input, reminder) => {
            const config = await configuredSession(adminId);
            const queue = createWhatsAppOutbox(createTransactionalWhatsAppOutboxStore(tx), {
                configIdentity: async () => wahaConfigIdentity(config),
            });
            return queue.enqueue(wahaSafetyKey(adminId, config), adminId, input,
                reminder.expiresAt - Date.now(), reminder);
        },
    });
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active: Promise<void>;
    let warnedAt = 0;
    const warn = () => {
        if (Date.now() - warnedAt < 300_000) return;
        warnedAt = Date.now();
        apiLogger.getChild('pppoe-reminders').warn('Some expiry reminders could not be queued. Check migrations, WhatsApp configuration and queue capacity; eligible reminders will be retried.');
    };
    const tick = async () => {
        try { if ((await scheduler.tick()).failed) warn(); }
        catch { warn(); }
        finally { if (!stopped) timer = setTimeout(() => { active = tick(); }, 60_000); }
    };
    active = tick();
    return async () => { stopped = true; clearTimeout(timer); await active; };
}

// Internal callers must supply the owning admin's trusted server-side ID.
export function sendAdminWhatsAppText(
    adminId: string,
    phone: string,
    text: string,
): Promise<WhatsAppAccepted> {
    // This internal entry point is used by portal reset-code delivery, not admin messages.
    return otpWhatsApp.sendText(adminId, phone, text);
}
