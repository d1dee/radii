import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { adminSetting, whatsappOutbox } from '../db/schema';
import { env } from '../env';
import { apiLogger } from '../logging';
import { createWahaClient, WahaError, type WhatsAppAccepted, type WahaSessionConfig } from './waha';
import { createWahaSettingsService } from './wahaSettings';
import { createWhatsAppOutbox, emptyWhatsAppOutbox, invalidateWhatsAppConfiguration, migrateWhatsAppScheduling, restrictWhatsAppOutbox, whatsAppWaitingReasons, wahaSafetyKey, wahaConfigIdentity, type WhatsAppJob, type WhatsAppOutboxStore, type WhatsAppOutboxState } from './wahaOutbox';
import { createPppoeExpiryReminderScheduler, isPppoeReminderCurrent } from './pppoeExpiryReminders';

// Older Bun SQL writes could persist the document as a JSON string.
const settingsDocument = sql`(case when jsonb_typeof(${adminSetting.settings}) = 'string' then (${adminSetting.settings} #>> '{}')::jsonb else ${adminSetting.settings} end)`;
// PostgreSQL 18 is the supported deployment. Reject malformed legacy strings
// before casting so a single damaged document cannot poison worker discovery.
const outboxDocument = sql`(case when jsonb_typeof(${whatsappOutbox.state}) = 'string'
    and pg_input_is_valid(${whatsappOutbox.state} #>> '{}', 'jsonb')
    then (${whatsappOutbox.state} #>> '{}')::jsonb else ${whatsappOutbox.state} end)`;
const outboxJobs = sql`(case when jsonb_typeof(${outboxDocument}->'jobs') = 'array' then ${outboxDocument}->'jobs' else '[]'::jsonb end)`;
const outboxTime = (field: string) => sql`(case when ${outboxDocument}->>${field} ~ '^[0-9]{1,16}$' then (${outboxDocument}->>${field})::bigint else 0 end)`;
export const whatsAppOutboxDue = (time: number) => and(
    sql`exists (select 1 from jsonb_array_elements(${outboxJobs}) j where j->>'status' in ('queued', 'processing'))`,
    // JSONPath comparisons safely ignore malformed timestamp values.
    sql`((${outboxDocument}->>'schedulingVersion') is null or ${outboxTime('nextAt')} <= ${time} or
        jsonb_path_exists(${outboxJobs}, '$[*] ? ((@.status == "queued" && @.expiresAt <= $now) || (@.status == "processing" && (!exists(@.startedAt) || @.startedAt < $stale)))',
            jsonb_build_object('now', ${time}::bigint, 'stale', ${time - 180_000}::bigint), true))`,
);
export const whatsAppOutboxReceiptsDue = (time: number) => and(
    sql`${outboxTime('receiptsNextAt')} <= ${time}`,
    sql`jsonb_path_exists(${outboxJobs}, '$[*] ? (@.previewExpiresAt <= $now || (@.status == "accepted" && exists(@.messageId) && @.createdAt > $cutoff && (!exists(@.ack) || @.ack < 3) && (!exists(@.nextReceiptAt) || @.nextReceiptAt <= $now)))',
        jsonb_build_object('now', ${time}::bigint, 'cutoff', ${time - 86_400_000}::bigint), true)`,
);

export function decodeWhatsAppOutbox(value: unknown): WhatsAppOutboxState {
    if (typeof value === 'string') value = JSON.parse(value);
    if (!value || typeof value !== 'object' || !Array.isArray((value as WhatsAppOutboxState).jobs)
        || !Array.isArray((value as WhatsAppOutboxState).attempts))
        throw new Error('Invalid persisted WhatsApp outbox.');
    return value as WhatsAppOutboxState;
}

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
                await tx.execute(sql`set local lock_timeout = '2s'`);
                await tx.execute(sql`set local statement_timeout = '5s'`);
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
                        queue.state = decodeWhatsAppOutbox(queue.state);
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
export function createTransactionalWhatsAppOutboxStore(tx: Pick<typeof db, 'insert' | 'select' | 'update' | 'execute'>): WhatsAppOutboxStore {
    return {
        async change(key, adminId, change) {
            // SET LOCAL is confined to the caller's transaction, never the pool.
            await tx.execute(sql`set local lock_timeout = '2s'`);
            await tx.execute(sql`set local statement_timeout = '5s'`);
            await tx.insert(whatsappOutbox).values({ sessionKey: key, adminId,
                state: sql`${JSON.stringify(emptyWhatsAppOutbox())}::text::jsonb` }).onConflictDoNothing();
            const [row] = await tx.select().from(whatsappOutbox).where(eq(whatsappOutbox.sessionKey, key)).for('update');
            if (!row || row.adminId !== adminId) throw new WahaError('WAHA_CONFLICT', 409, 'This WhatsApp session belongs to another admin.');
            row.state = decodeWhatsAppOutbox(row.state);
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
    let currentKey: string | undefined;
    let waitingReason: string | undefined;
    try { currentKey = wahaSafetyKey(adminId, await configuredSession(adminId)); }
    catch { waitingReason = whatsAppWaitingReasons.configuration; }
    const current = views[rows.findIndex((r) => r.sessionKey === currentKey)];
    waitingReason ??= current?.waitingReason;
    if (!(current ? [current] : views).some((view) => view.jobs.some((job) => job.status === 'queued'))) waitingReason = undefined;
    return { paused: current?.paused ?? false, nextAt: current?.nextAt ?? 0, ...(waitingReason ? { waitingReason } : {}),
        jobs: views.flatMap((v) => v.jobs).sort((a, b) => b.createdAt - a.createdAt).slice(0, 100) };
}

export async function resumeAdminWhatsAppOutbox(adminId: string) {
    const config = await configuredSession(adminId);
    return outbox.resume(wahaSafetyKey(adminId, config), adminId,
        () => createWahaClient(config).getStatus(adminId), wahaConfigIdentity(config));
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
    let waitingReason: string = whatsAppWaitingReasons.unavailable;
    try {
        const status = await getStatus();
        if (status.configured && status.status === 'WORKING') {
            return store.change(key, adminId, (state) => {
                if (state.paused) return false;
                delete state.waitingReason;
                return true;
            });
        }
        waitingReason = status.configured ? whatsAppWaitingReasons.session : whatsAppWaitingReasons.configuration;
    } catch (error) {
        restricted = error instanceof WahaError && error.code === 'WAHA_RESTRICTED';
    }
    await store.change(key, adminId, (state) => {
        if (restricted) restrictWhatsAppOutbox(state);
        else if (!state.paused) state.waitingReason = waitingReason;
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
            const rows = await db.select().from(whatsappOutbox).where(whatsAppOutboxDue(Date.now())).orderBy(outboxTime('nextAt')).limit(4);
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
                        if (!s.paused) s.waitingReason = whatsAppWaitingReasons.configuration;
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
            const receiptRows = await db.select().from(whatsappOutbox).where(whatsAppOutboxReceiptsDue(Date.now())).orderBy(outboxTime('receiptsNextAt')).limit(2);
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
