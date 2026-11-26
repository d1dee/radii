import { adminSettingsSchema, renderPppoeExpiryReminderTemplate, zPhoneNumber, type AdminSettings } from '@radii/shared';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../db';
import { activatedPackages as a, adminSetting, adminUser, nasDevice, packagePayments as payment, packages, pppoeExpiryReminders, pppoeServiceAccounts as account, user, userAdminTag } from '../db/schema';
import { adminWhatsAppTextSchema } from './waha';
import type { WhatsAppJob } from './wahaOutbox';

type Executor = Pick<typeof db, 'select' | 'insert' | 'update'>;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Schedule = AdminSettings['messaging']['pppoeExpiryReminderSchedule'];
export const REMINDER_BATCH_SIZE = 100;

export function isPppoeReminderDue(start: number, expiry: number, schedule: Schedule, now: number) {
    if (!schedule.enabled || !Number.isFinite(start) || !Number.isFinite(expiry) || start > now || expiry <= now || expiry <= start) return false;
    const lead = schedule.timingMode === 'percentage'
        ? (expiry - start) * schedule.remainingPercentage / 100
        : schedule.leadTimeHours * 3_600_000;
    // A missed tick may catch up anywhere in the configured pre-expiry window,
    // never after expiry. Short subscriptions can enter the hours window at activation.
    return expiry - now <= lead;
}

function candidates(executor: Executor, now: number, activationId?: string, afterId?: string, unqueuedOnly = false) {
    const schedule = sql`${adminSetting.settings}->'messaging'->'pppoeExpiryReminderSchedule'`;
    return executor.select({ activation: a, account, pkg: packages, settings: adminSetting.settings, customerName: userAdminTag.name, portalName: user.name })
        .from(a)
        .innerJoin(account, eq(a.pppoeServiceAccountId, account.id))
        .innerJoin(payment, and(eq(a.packagePaymentId, payment.id), eq(payment.pppoeServiceAccountId, account.id), eq(payment.tenantAdminId, account.tenantAdminId), eq(payment.userId, a.userId), eq(payment.packageId, a.packageId), eq(payment.status, 'paid')))
        .innerJoin(nasDevice, and(eq(account.nasDeviceId, nasDevice.id), eq(payment.nasDeviceId, nasDevice.id), eq(nasDevice.ownerId, account.tenantAdminId)))
        .innerJoin(adminUser, eq(adminUser.id, account.tenantAdminId))
        .innerJoin(adminSetting, eq(adminSetting.adminUserId, adminUser.id))
        .innerJoin(user, and(eq(a.userId, user.id), eq(account.customerUserId, user.id)))
        .innerJoin(packages, eq(a.packageId, packages.id))
        .leftJoin(userAdminTag, and(eq(userAdminTag.adminId, account.tenantAdminId), eq(userAdminTag.userId, user.id)))
        .where(and(
            activationId ? eq(a.id, activationId) : undefined,
            afterId ? gt(a.id, afterId) : undefined,
            unqueuedOnly ? sql`not exists (select 1 from pppoe_expiry_reminder r where r.activation_id = ${a.id} and r.activated_at = ${a.activatedAt} and r.expires_at = ${a.expireAt})` : undefined,
            eq(account.status, 'active'), eq(packages.type, 'pppoe'), eq(packages.noExpiry, false),
            isNull(a.timeAllowanceSeconds), isNull(a.deactivatedAt), gt(a.expireAt, new Date(now)),
            sql`${a.activatedAt} <= ${new Date(now)}`,
            sql`coalesce(${adminUser.banned}, false) = false`, sql`coalesce(${user.banned}, false) = false`,
            sql`${adminSetting.settings}->'messaging'->'pppoeExpiryReminderSchedule'->>'enabled' = 'true'`,
            // Filter due windows in SQL so large numbers of future subscriptions
            // cannot delay a one-hour reminder until after its expiry. Guard
            // casts against malformed legacy JSON; schema validation still fails closed.
            sql`extract(epoch from (${a.expireAt} - ${new Date(now)}::timestamptz)) <=
                case when ${schedule}->>'timingMode' = 'percentage' then
                    extract(epoch from (${a.expireAt} - ${a.activatedAt})) *
                    coalesce(case when jsonb_typeof(${schedule}->'remainingPercentage') = 'number'
                        then (${schedule}->>'remainingPercentage')::numeric end, 10) / 100
                else coalesce(case when jsonb_typeof(${schedule}->'leadTimeHours') = 'number'
                        then (${schedule}->>'leadTimeHours')::numeric end, 24) * 3600 end`,
            // Match the current calendar activation, not an older overlapping purchase.
            sql`not exists (select 1 from activated_packages newer join packages np on np.id = newer.package_id
                where newer.pppoe_service_account_id = ${account.id} and np.type = 'pppoe'
                and newer.deactivated_at is null and newer.expires_at > ${new Date(now)}
                and (newer.activated_at > ${a.activatedAt} or (newer.activated_at = ${a.activatedAt} and newer.id > ${a.id})))`,
        )).orderBy(a.id).limit(REMINDER_BATCH_SIZE);
}

function reminderText(row: Awaited<ReturnType<typeof candidates>>[number], settings: AdminSettings) {
    const { timezone, timeFormat, currencyLabel } = settings.appearance;
    const expiry = row.activation.expireAt;
    const date = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, day: '2-digit', month: 'short', year: 'numeric' }).format(expiry);
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: timeFormat === '12h' }).format(expiry);
    return renderPppoeExpiryReminderTemplate(settings.messaging.pppoeExpiryReminderTemplate, {
        customer_name: row.customerName?.trim() || row.account.customerName?.trim() || row.portalName?.trim() || 'Customer',
        account_label: row.account.label?.trim() || '',
        location: row.account.location?.trim() || '',
        username: row.account.username, package_name: row.pkg.title, expiry_date: date, expiry_time: time,
        amount: `${currencyLabel} ${new Intl.NumberFormat('en-KE', { maximumFractionDigits: 2 }).format(Number(row.pkg.price))}`,
        whatsapp_support: settings.contacts.adminWhatsapp || 'your service provider',
        tel_support: settings.contacts.adminTel || 'your service provider',
    });
}

export async function isPppoeReminderCurrent(executor: Executor, adminId: string, job: WhatsAppJob, now = Date.now()) {
    if (!job.reminder || job.expiresAt <= now) return false;
    const [row] = await candidates(executor, now, job.reminder.activationId);
    if (!row || !zPhoneNumber.safeParse(row.account.normalizedPhone).success || row.account.tenantAdminId !== adminId || row.activation.activatedAt.getTime() !== job.reminder.activatedAt || row.activation.expireAt.getTime() !== job.reminder.expiresAt || row.account.normalizedPhone.replace(/^\+/, '') !== job.phone) return false;
    const parsed = adminSettingsSchema.safeParse(row.settings);
    return parsed.success && isPppoeReminderDue(job.reminder.activatedAt, job.reminder.expiresAt, parsed.data.messaging.pppoeExpiryReminderSchedule, now);
}

export function createPppoeExpiryReminderScheduler(database: typeof db, options: {
    enqueue: (tx: Transaction, adminId: string, input: { phones: string[]; text: string; requestId: string }, reminder: NonNullable<WhatsAppJob['reminder']>) => Promise<unknown>;
    now?: () => number;
}) {
    const now = options.now ?? Date.now;
    let cursor: string | undefined;
    return {
        async tick() {
            const rows = await candidates(database, now(), undefined, cursor, true);
            cursor = rows.length === REMINDER_BATCH_SIZE ? rows.at(-1)!.activation.id : undefined;
            let queued = 0; let failed = 0;
            for (const candidate of rows) {
                try {
                    queued += await database.transaction(async (tx) => {
                        // Serialize the cycle with activation edits, then re-read status,
                        // tenant settings and current subscription immediately before enqueue.
                        await tx.select({ id: a.id }).from(a).where(eq(a.id, candidate.activation.id)).for('update');
                        const [row] = await candidates(tx, now(), candidate.activation.id);
                        if (!row) return 0;
                        const parsed = adminSettingsSchema.safeParse(row.settings);
                        if (!parsed.success || !isPppoeReminderDue(row.activation.activatedAt.getTime(), row.activation.expireAt.getTime(), parsed.data.messaging.pppoeExpiryReminderSchedule, now())) return 0;
                        const text = reminderText(row, parsed.data);
                        if (!zPhoneNumber.safeParse(row.account.normalizedPhone).success || !adminWhatsAppTextSchema.safeParse({ phone: row.account.normalizedPhone, text }).success) return 0;
                        const requestId = randomUUID();
                        const [claim] = await tx.insert(pppoeExpiryReminders).values({
                            activationId: row.activation.id, activatedAt: row.activation.activatedAt, expiresAt: row.activation.expireAt,
                            adminId: row.account.tenantAdminId, batchId: requestId,
                        }).onConflictDoNothing().returning({ id: pppoeExpiryReminders.activationId });
                        if (!claim) return 0;
                        // The ledger and durable queue commit together. Queue-full,
                        // unconfigured transport or database errors roll back the claim.
                        await options.enqueue(tx, row.account.tenantAdminId, { phones: [row.account.normalizedPhone], text, requestId }, {
                            activationId: row.activation.id, activatedAt: row.activation.activatedAt.getTime(), expiresAt: row.activation.expireAt.getTime(),
                        });
                        return 1;
                    });
                } catch { failed++; }
            }
            return { scanned: rows.length, queued, failed };
        },
    };
}
