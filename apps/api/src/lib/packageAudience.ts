import {
    PACKAGE_AUDIENCE_METRICS,
    packageAudienceConditionsSchema,
    packageEligibilitySchema,
    type PackageAudienceConditions,
    type PackageAudienceRule,
} from '@radii/shared';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import type { db } from '../db';
import {
    activatedPackages, customerTags, hotspotLoginRequest, nasDevice,
    packageAudiences, packagePayments, packages, pppoeServiceAccounts,
    radacct, transaction, user,
} from '../db/schema';
import { scopedNasHistoryAddress } from './nasHistory';
import { calculateActivationTime } from './radius/activationLimits';
import { bankSessionUsage } from './radius/bankUsage';

export type PackageAudienceExecutor = Pick<typeof db, 'select'>;
export type AudiencePackage = { id: string; audienceId?: string | null; eligibility?: unknown };
export type PackageEligibilityResult = { eligible: boolean; reasons: string[] };
type Payment = {
    id: string; packageId: string; category: string; type: string;
    status: string; amount: number; createdAt: Date; reversed: boolean;
};
type Activation = {
    activation: typeof activatedPackages.$inferSelect;
    package: typeof packages.$inferSelect;
};
type Session = typeof radacct.$inferSelect & { audienceService?: 'hotspot' | 'pppoe' };
export type PackageAudienceFacts = {
    accountCreatedAt: Date | null;
    relationshipStartedAt: Date | null;
    relationshipStartedAtByService: Record<'hotspot' | 'pppoe', Date | null>;
    payments: Payment[];
    activations: Activation[];
    sessions: Session[];
    tags: string[];
    pppoeActiveAccountCount: number;
};

const DAY = 86_400_000;

/** All reads use the supplied executor, including inside a purchase transaction. */
export function createPackageAudienceContext(options: {
    executor: PackageAudienceExecutor;
    providerId: string;
    userId?: string | null;
    now?: Date;
    reservePending?: boolean;
}) {
    const now = new Date(options.now ?? Date.now());
    let facts: Promise<PackageAudienceFacts> | undefined;
    let audiences: Promise<Map<string, typeof packageAudiences.$inferSelect>> | undefined;
    const metrics = new Map<string, ReturnType<typeof packageAudienceMetricValue>>();
    let paymentsByPackage: Map<string, Payment[]> | undefined;
    const getPackagePayments = (facts: PackageAudienceFacts, packageId: string) => {
        if (!paymentsByPackage) {
            paymentsByPackage = new Map();
            for (const payment of facts.payments) {
                const rows = paymentsByPackage.get(payment.packageId) ?? [];
                rows.push(payment);
                paymentsByPackage.set(payment.packageId, rows);
            }
        }
        return paymentsByPackage.get(packageId) ?? [];
    };
    return {
        providerId: options.providerId,
        userId: options.userId ?? null,
        now,
        reservePending: options.reservePending ?? false,
        getPackagePayments,
        resolveMetric: (facts: PackageAudienceFacts, rule: PackageAudienceRule, packageId: string) => {
            const perPackage = rule.metric === 'redemption_count' || rule.metric === 'days_since_last_package_redemption';
            const key = `${rule.metric}:${rule.serviceScope ?? 'all'}:${rule.windowDays ?? 'lifetime'}:${perPackage ? packageId : '*'}`;
            if (!metrics.has(key)) metrics.set(key, packageAudienceMetricValue(perPackage ? { ...facts, payments: getPackagePayments(facts, packageId) } : facts, rule, packageId, options.userId ?? '', now));
            return metrics.get(key)!;
        },
        getFacts: () => facts ??= loadPackageAudienceFacts(options.executor, options.providerId, options.userId ?? null),
        getAudiences: () => audiences ??= options.executor.select().from(packageAudiences)
            .where(eq(packageAudiences.ownerId, options.providerId))
            .then((rows) => new Map(rows.map((row) => [row.id, row]))),
    };
}

export type PackageAudienceContext = ReturnType<typeof createPackageAudienceContext>;

async function loadPackageAudienceFacts(executor: PackageAudienceExecutor, providerId: string, userId: string | null): Promise<PackageAudienceFacts> {
    const empty: PackageAudienceFacts = { accountCreatedAt: null, relationshipStartedAt: null, relationshipStartedAtByService: { hotspot: null, pppoe: null }, payments: [], activations: [], sessions: [], tags: [], pppoeActiveAccountCount: 0 };
    if (!userId) return empty;
    // Explicit order-time tenancy wins. Only legacy unstamped orders fall back
    // to the NAS owner; package ownership/link changes never broaden history.
    const ownedPayment = sql`coalesce(${packagePayments.tenantAdminId}, ${nasDevice.ownerId}) = ${providerId}`;
    const [customers, payments, activations, sessions, logins, accounts, tags] = await Promise.all([
        executor.select({ createdAt: user.createdAt }).from(user).where(eq(user.id, userId)),
        executor.select({ payment: packagePayments, category: packages.category, type: packages.type, transactionStatus: transaction.status })
            .from(packagePayments).innerJoin(packages, eq(packagePayments.packageId, packages.id))
            .leftJoin(nasDevice, eq(packagePayments.nasDeviceId, nasDevice.id))
            .leftJoin(transaction, eq(packagePayments.transaction, transaction.id))
            .where(and(eq(packagePayments.userId, userId), ownedPayment)),
        executor.select({ activation: activatedPackages, package: packages }).from(activatedPackages)
            .innerJoin(packages, eq(activatedPackages.packageId, packages.id))
            .innerJoin(packagePayments, eq(activatedPackages.packagePaymentId, packagePayments.id))
            .leftJoin(nasDevice, eq(packagePayments.nasDeviceId, nasDevice.id))
            .where(and(eq(activatedPackages.userId, userId), eq(packagePayments.userId, userId), ownedPayment)),
        executor.select({ accounting: radacct }).from(radacct)
            .leftJoin(activatedPackages, sql`${radacct.class} = ${activatedPackages.id}::text or
                (nullif(${radacct.class}, '') is null and ${radacct.username} = 'PK-' || upper(left(replace(${activatedPackages.id}::text, '-', ''), 10)))`)
            .leftJoin(packagePayments, eq(activatedPackages.packagePaymentId, packagePayments.id))
            .leftJoin(nasDevice, eq(packagePayments.nasDeviceId, nasDevice.id))
            .where(and(isNotNull(radacct.acctstarttime), scopedNasHistoryAddress(sql`${radacct.nasipaddress}`, providerId), sql`(
                (${activatedPackages.userId} = ${userId} and ${packagePayments.userId} = ${userId} and ${ownedPayment})
                or (nullif(${radacct.class}, '') is null and (
                    exists (select 1 from ${pppoeServiceAccounts} account where account.username = ${radacct.username}
                        and account.customer_user_id = ${userId} and account.tenant_admin_id = ${providerId})
                    or exists (select 1 from ${hotspotLoginRequest} login inner join nas_device device on device.id = login.nas_device_id
                        where login.hotspot_username = ${radacct.username} and login.user_id = ${userId} and device.owner_id = ${providerId})
                ))
            )`)),
        executor.select({ createdAt: hotspotLoginRequest.createdAt, username: hotspotLoginRequest.hotspotUsername }).from(hotspotLoginRequest)
            .innerJoin(nasDevice, eq(hotspotLoginRequest.nasDeviceId, nasDevice.id))
            .where(and(eq(hotspotLoginRequest.userId, userId), eq(nasDevice.ownerId, providerId))),
        executor.select({ createdAt: pppoeServiceAccounts.createdAt, status: pppoeServiceAccounts.status, username: pppoeServiceAccounts.username }).from(pppoeServiceAccounts)
            .where(and(eq(pppoeServiceAccounts.customerUserId, userId), eq(pppoeServiceAccounts.tenantAdminId, providerId))),
        executor.select({ tag: customerTags.tag }).from(customerTags)
            .where(and(eq(customerTags.userId, userId), eq(customerTags.ownerId, providerId))),
    ]);
    const relationshipTimes = [...payments.map((row) => row.payment.createdAt), ...logins.map((row) => row.createdAt), ...accounts.map((row) => row.createdAt), ...sessions.flatMap((row) => row.accounting.acctstarttime ? [row.accounting.acctstarttime] : [])];
    const serviceByActivation = new Map(activations.map((row) => [row.activation.id, row.package.type]));
    const serviceByUsername = new Map<string, 'hotspot' | 'pppoe' | null>();
    const recordUsernameService = (username: string, service: 'hotspot' | 'pppoe') => {
        serviceByUsername.set(username, serviceByUsername.has(username) && serviceByUsername.get(username) !== service ? null : service);
    };
    for (const account of accounts) recordUsernameService(account.username, 'pppoe');
    for (const login of logins) if (login.username) recordUsernameService(login.username, 'hotspot');
    for (const row of activations) if (row.package.type === 'hotspot') recordUsernameService(`PK-${row.activation.id.replace(/-/g, '').slice(0, 10).toUpperCase()}`, 'hotspot');
    const attributedSessions = sessions.map(({ accounting }) => ({ ...accounting, audienceService: serviceByActivation.get(accounting.class ?? '') ?? serviceByUsername.get(accounting.username ?? '') ?? undefined }));
    const first = (dates: Date[]) => dates.length ? new Date(dates.reduce((earliest, date) => Math.min(earliest, date.getTime()), Infinity)) : null;
    const relationshipStartedAtByService = {
        hotspot: first([
            ...payments.filter((row) => row.type === 'hotspot').map((row) => row.payment.createdAt),
            ...logins.map((row) => row.createdAt),
            ...attributedSessions.filter((row) => row.audienceService === 'hotspot').flatMap((row) => row.acctstarttime ? [row.acctstarttime] : []),
        ]),
        pppoe: first([
            ...payments.filter((row) => row.type === 'pppoe').map((row) => row.payment.createdAt),
            ...accounts.map((row) => row.createdAt),
            ...attributedSessions.filter((row) => row.audienceService === 'pppoe').flatMap((row) => row.acctstarttime ? [row.acctstarttime] : []),
        ]),
    };
    return {
        accountCreatedAt: customers[0]?.createdAt ?? null,
        relationshipStartedAt: first(relationshipTimes),
        relationshipStartedAtByService,
        payments: payments.map((row) => ({ ...row.payment, category: row.category, type: row.type, amount: Number(row.payment.amount), reversed: row.transactionStatus === 'reversed' })),
        activations,
        sessions: attributedSessions,
        tags: tags.map((row) => row.tag),
        pppoeActiveAccountCount: accounts.filter((row) => row.status === 'active').length,
    };
}

function sessionSeconds(session: Session, now: Date): number {
    if (!session.acctstarttime) return 0;
    return session.acctstoptime === null
        ? Math.max(0, (now.getTime() - session.acctstarttime.getTime()) / 1000)
        : Math.max(0, session.acctsessiontime ?? ((session.acctstoptime.getTime() - session.acctstarttime.getTime()) / 1000));
}

/** Pure metric resolver. Null means unknown/not applicable, never numeric zero. */
export function packageAudienceMetricValue(facts: PackageAudienceFacts, rule: PackageAudienceRule, packageId: string, userId: string, now: Date): number | boolean | string[] | null {
    const cutoff = rule.windowDays == null ? -Infinity : now.getTime() - rule.windowDays * DAY;
    const service = rule.serviceScope && rule.serviceScope !== 'all' ? rule.serviceScope : null;
    const stateMetric = ['active_subscription_count', 'current_package_ids', 'current_package_categories', 'expired_subscription_count', 'expiring_subscription_count', 'quota_consumption_percent', 'time_consumption_percent'].includes(rule.metric);
    const paymentMetric = ['successful_paid_purchase_count', 'spend', 'redemption_count', 'days_since_last_package_redemption', 'previous_purchased_package_ids', 'previous_purchased_package_categories'].includes(rule.metric);
    const sessionMetric = stateMetric || ['never_connected', 'days_since_last_connection', 'used_service_count', 'data_usage_bytes', 'connected_seconds', 'distinct_connection_days'].includes(rule.metric);
    const paid = paymentMetric ? facts.payments.filter((payment) => payment.status === 'paid' && !payment.reversed && payment.createdAt.getTime() <= now.getTime() && (!service || payment.type === service)) : [];
    const purchases = paid.filter((payment) => payment.amount > 0 && payment.createdAt.getTime() >= cutoff);
    const redemptions = paid.filter((payment) => payment.packageId === packageId);
    const activations = stateMetric ? facts.activations.filter((row) => !service || row.package.type === service) : [];
    const serviceByActivation = new Map(sessionMetric ? facts.activations.map((row) => [row.activation.id, row.package.type]) : []);
    const sessionService = (session: Session) => session.audienceService ?? serviceByActivation.get(session.class ?? '');
    const recordedSessions = sessionMetric ? facts.sessions.filter((session) => session.acctstarttime && session.acctstarttime.getTime() <= now.getTime()) : [];
    // Unknown attribution must not make someone look new to a service. Keep
    // absence, negative comparisons and rolling usage rules fail-closed.
    if (service && sessionMetric && !stateMetric && recordedSessions.some((session) =>
        !sessionService(session) && (session.acctstoptime?.getTime() ?? now.getTime()) >= cutoff)) return null;
    const sessions = recordedSessions.filter((session) => !service || sessionService(session) === service);
    const age = (date: Date | null) => date ? Math.max(0, (now.getTime() - date.getTime()) / DAY) : null;
    const last = (dates: Date[]) => dates.length ? new Date(dates.reduce((latest, date) => Math.max(latest, date.getTime()), -Infinity)) : null;
    const states = stateMetric ? activations.map(({ activation, package: pkg }) => {
        const accounting = sessions.filter((session) => session.class === activation.id || (!session.class && pkg.type === 'hotspot' && session.username === `PK-${activation.id.replace(/-/g, '').slice(0, 10).toUpperCase()}`));
        const usedSeconds = accounting.reduce((total, session) => {
            const seconds = sessionSeconds(session, now);
            return total + (pkg.noExpiry ? bankSessionUsage(seconds, session, session.acctstoptime === null).bankChargedSeconds : seconds);
        }, 0);
        const balance = calculateActivationTime({ activatedAt: activation.activatedAt, expireAt: activation.expireAt, packageAllowanceSeconds: pkg.sessionLength * 60, allowanceOverrideSeconds: activation.timeAllowanceSeconds, usedSeconds, cumulative: pkg.noExpiry, now });
        const input = accounting.reduce((sum, session) => sum + Math.max(0, session.acctinputoctets ?? 0), 0);
        const output = accounting.reduce((sum, session) => sum + Math.max(0, session.acctoutputoctets ?? 0), 0);
        const quotaBytes = (pkg.uploadQuota + pkg.downloadQuota) * 1024;
        const quotaPercent = quotaBytes > 0 ? [(input + output) / quotaBytes * 100] : [];
        const active = activation.deactivatedAt === null && activation.activatedAt <= now && balance.remainingSeconds > 0;
        const cumulative = pkg.noExpiry || activation.timeAllowanceSeconds !== null;
        const timePercent = cumulative
            ? usedSeconds / Math.max(1, activation.timeAllowanceSeconds ?? pkg.sessionLength * 60) * 100
            : (now.getTime() - activation.activatedAt.getTime()) / Math.max(1, activation.expireAt.getTime() - activation.activatedAt.getTime()) * 100;
        return { activation, pkg, active, quotaPercent, timePercent };
    }) : [];
    const active = states.filter((state) => state.active);
    switch (rule.metric) {
        case 'account_age_days': return age(facts.accountCreatedAt);
        case 'tenure_days': return age(service ? facts.relationshipStartedAtByService[service] : facts.relationshipStartedAt);
        case 'successful_paid_purchase_count': return purchases.length;
        case 'spend': return purchases.reduce((sum, payment) => sum + Math.round(payment.amount * 100), 0) / 100;
        case 'never_connected': return sessions.length === 0;
        case 'days_since_last_connection': return age(last(sessions.map((session) => session.acctstoptime === null ? now : session.acctstoptime)));
        case 'redemption_count': return redemptions.filter((payment) => payment.createdAt.getTime() >= cutoff).length;
        case 'days_since_last_package_redemption': return age(last(redemptions.map((payment) => payment.createdAt)));
        case 'previous_purchased_package_ids': return [...new Set(purchases.map((payment) => payment.packageId))];
        case 'previous_purchased_package_categories': return [...new Set(purchases.map((payment) => payment.category))];
        case 'current_package_ids': return [...new Set(active.map((state) => state.pkg.id))];
        case 'current_package_categories': return [...new Set(active.map((state) => state.pkg.category))];
        case 'active_subscription_count': return active.length;
        case 'expired_subscription_count': return states.filter((state) => state.activation.expireAt.getTime() <= now.getTime() && state.activation.expireAt.getTime() >= cutoff).length;
        case 'expiring_subscription_count': return active.filter((state) => rule.windowDays == null || state.activation.expireAt.getTime() <= now.getTime() + rule.windowDays * DAY).length;
        case 'quota_consumption_percent': {
            const values = active.flatMap((state) => state.quotaPercent);
            return values.length ? Math.max(...values) : null;
        }
        case 'time_consumption_percent': return active.length ? Math.max(...active.map((state) => state.timePercent)) : null;
        case 'pppoe_active_account_count': return facts.pppoeActiveAccountCount;
        case 'used_service_count': {
            return new Set(sessions.filter((session) => (session.acctstoptime?.getTime() ?? now.getTime()) >= cutoff)
                .map(sessionService)
                .filter((service) => service !== undefined)).size;
        }
        case 'user_ids': return [userId];
        case 'customer_tags': return facts.tags;
        case 'data_usage_bytes': {
            let bytes = 0;
            for (const session of sessions) {
                if ((session.acctstoptime?.getTime() ?? now.getTime()) <= cutoff) continue;
                const total = Math.max(0, session.acctinputoctets ?? 0) + Math.max(0, session.acctoutputoctets ?? 0);
                // A cumulative counter cannot be accurately split at a rolling
                // boundary. The lazy FUP ledger is not a complete byte meter.
                if (session.acctstarttime!.getTime() < cutoff && total > 0) return null;
                bytes += total;
            }
            return bytes;
        }
        case 'connected_seconds': return sessions.reduce((total, session) => {
            const start = session.acctstarttime!.getTime();
            const end = Math.min(now.getTime(), session.acctstoptime?.getTime() ?? now.getTime());
            return total + Math.min(sessionSeconds(session, now), Math.max(0, (end - Math.max(start, cutoff)) / 1000));
        }, 0);
        case 'distinct_connection_days': {
            const days = new Set<number>();
            for (const session of sessions) {
                const start = Math.max(session.acctstarttime!.getTime(), cutoff);
                const end = Math.min(now.getTime(), session.acctstoptime?.getTime() ?? now.getTime());
                if (end < start || (end === start && session.acctstarttime!.getTime() < start)) continue;
                const lastConnectedInstant = session.acctstoptime ? Math.max(start, end - 1) : end;
                for (let day = Math.floor(start / DAY); day <= Math.floor(lastConnectedInstant / DAY); day++) days.add(day);
            }
            return days.size;
        }
    }
}

export function evaluatePackageAudienceConditions(conditions: unknown, resolve: (rule: PackageAudienceRule) => number | boolean | string[] | null): PackageEligibilityResult {
    const parsed = packageAudienceConditionsSchema.safeParse(conditions);
    if (!parsed.success) return { eligible: false, reasons: ['Invalid audience conditions'] };
    const results = parsed.data.rules.map((rule) => {
        const actual = resolve(rule);
        let matches = false;
        if (actual !== null && !(typeof actual === 'number' && !Number.isFinite(actual))) {
            switch (rule.operator) {
                case 'eq': matches = actual === rule.value; break;
                case 'ne': matches = actual !== rule.value; break;
                case 'gt': matches = typeof actual === 'number' && actual > (rule.value as number); break;
                case 'gte': matches = typeof actual === 'number' && actual >= (rule.value as number); break;
                case 'lt': matches = typeof actual === 'number' && actual < (rule.value as number); break;
                case 'lte': matches = typeof actual === 'number' && actual <= (rule.value as number); break;
                case 'includes_any': matches = Array.isArray(actual) && (rule.value as string[]).some((value) => actual.includes(value)); break;
                case 'includes_all': matches = Array.isArray(actual) && (rule.value as string[]).every((value) => actual.includes(value)); break;
                case 'includes_none': matches = Array.isArray(actual) && (rule.value as string[]).every((value) => !actual.includes(value)); break;
            }
        }
        const label = `${PACKAGE_AUDIENCE_METRICS[rule.metric].label}${rule.serviceScope && rule.serviceScope !== 'all' ? ` (${rule.serviceScope === 'pppoe' ? 'PPPoE' : 'Hotspot'})` : ''}`;
        const unavailable = rule.metric === 'data_usage_bytes' && rule.windowDays != null
            ? `${label} is unavailable: recorded accounting cannot reliably establish usage for this window`
            : `${label} is unavailable`;
        return { matches, reason: actual === null ? unavailable : rule.metric === 'user_ids'
            ? 'Customer number does not match the selected customer rule'
            : `${label} does not meet ${rule.operator} ${JSON.stringify(rule.value)}` };
    });
    const eligible = parsed.data.mode === 'all' ? results.every((result) => result.matches) : results.some((result) => result.matches);
    return { eligible, reasons: eligible ? [] : results.filter((result) => !result.matches).map((result) => result.reason) };
}

/** Local rules AND reusable audience AND per-package redemption limits. */
export async function evaluatePackageEligibility(context: PackageAudienceContext, pkg: AudiencePackage): Promise<PackageEligibilityResult> {
    const parsed = packageEligibilitySchema.nullable().safeParse(pkg.eligibility ?? null);
    if (!parsed.success) return { eligible: false, reasons: ['Invalid package eligibility configuration'] };
    const eligibility = parsed.data;
    // Enabling targeting is enough to make an offer private, even before
    // its first rule is added. Do not resolve audiences for anonymous visitors.
    if (!pkg.audienceId && eligibility === null) return { eligible: true, reasons: [] };
    if (!context.userId) return { eligible: false, reasons: ['Sign in to check package eligibility'] };
    const conditions: PackageAudienceConditions[] = [];
    if (eligibility) conditions.push({ mode: eligibility.mode, rules: eligibility.rules });
    if (pkg.audienceId) {
        const audience = (await context.getAudiences()).get(pkg.audienceId);
        if (!audience || audience.ownerId !== context.providerId) return { eligible: false, reasons: ['Audience is unavailable for this provider'] };
        const parsedAudience = packageAudienceConditionsSchema.safeParse(audience.conditions);
        if (!parsedAudience.success) return { eligible: false, reasons: ['Invalid reusable audience configuration'] };
        conditions.push(parsedAudience.data);
    }
    const facts = await context.getFacts();
    if (!facts.accountCreatedAt) return { eligible: false, reasons: ['Customer account is unavailable'] };
    const reasons = conditions.flatMap((condition) => evaluatePackageAudienceConditions(condition, (rule) => context.resolveMetric(facts, rule, pkg.id)).reasons);
    const redemptions = context.getPackagePayments(facts, pkg.id).filter((payment) => !payment.reversed && (payment.status === 'paid' || (context.reservePending && payment.status === 'pending')));
    if (context.reservePending && redemptions.some((payment) => payment.status === 'pending')) reasons.push('A purchase of this package is already pending');
    if (eligibility?.maxRedemptions != null && redemptions.length >= eligibility.maxRedemptions) reasons.push('Package redemption limit reached');
    if (eligibility?.cooldownDays != null && redemptions.some((payment) => payment.createdAt.getTime() + eligibility.cooldownDays! * DAY > context.now.getTime())) reasons.push('Package redemption cooldown has not elapsed');
    return { eligible: reasons.length === 0, reasons };
}
