// Admin customer (hotspot/PPPoE user) management queries: listing with
// aggregates, per-user valuation detail, the global payment log and reporting
// data. Users come from the better-auth `user` table; everything else is
// joined from the domain tables (payments, activations, flags, accounting).

import {
    and,
    count,
    desc,
    eq,
    exists,
    gte,
    ilike,
    inArray,
    isNotNull,
    isNull,
    lte,
    or,
    sql,
} from 'drizzle-orm';
import { db } from '../db';
import {
    activatedPackages,
    packagePayments,
    packages,
    radacct,
    transaction,
    user,
    userFlag,
} from '../db/schema';

export type AdminUserTypeFilter = 'hotspot' | 'pppoe';

// --- User listing -----------------------------------------------------------

export interface ListAdminUsersOpts {
    // Matches name, phone (username) or email.
    q?: string;
    // Only users with at least one activation of this package type.
    type?: AdminUserTypeFilter;
    // Only users carrying at least one flag.
    flagged?: boolean;
    page?: number;
    perPage?: number;
}

async function userAggregates(userIds: string[]) {
    if (userIds.length === 0) {
        return {
            payments: new Map<
                string,
                {
                    total: number;
                    paid: number;
                    pending: number;
                    failed: number;
                    revenue: number;
                }
            >(),
            activations: new Map<
                string,
                { total: number; active: number; hotspot: number; pppoe: number }
            >(),
            flags: new Map<string, number>(),
            online: new Set<string>(),
            lastPayment: new Map<string, Date>(),
        };
    }

    const paymentRows = await db
        .select({
            userId: packagePayments.userId,
            total: count(packagePayments.id),
            paid: sql<number>`count(*) filter (where ${packagePayments.status} = 'paid')`,
            pending: sql<number>`count(*) filter (where ${packagePayments.status} = 'pending')`,
            failed: sql<number>`count(*) filter (where ${packagePayments.status} = 'failed')`,
            revenue: sql<number>`coalesce(sum(${packagePayments.amount}) filter (where ${packagePayments.status} = 'paid'), 0)::float8`,
            lastAt: sql<Date>`max(${packagePayments.createdAt})`,
        })
        .from(packagePayments)
        .where(inArray(packagePayments.userId, userIds))
        .groupBy(packagePayments.userId);

    const activationRows = await db
        .select({
            userId: activatedPackages.userId,
            total: count(activatedPackages.id),
            active: sql<number>`count(*) filter (where ${activatedPackages.expireAt} > now())`,
            hotspot: sql<number>`count(*) filter (where ${packages.type} = 'hotspot')`,
            pppoe: sql<number>`count(*) filter (where ${packages.type} = 'pppoe')`,
        })
        .from(activatedPackages)
        .innerJoin(packages, eq(activatedPackages.packageId, packages.id))
        .where(inArray(activatedPackages.userId, userIds))
        .groupBy(activatedPackages.userId);

    const flagRows = await db
        .select({
            userId: userFlag.userId,
            total: count(userFlag.id),
        })
        .from(userFlag)
        .where(inArray(userFlag.userId, userIds))
        .groupBy(userFlag.userId);

    // Online now: a live accounting record of any of the user's activations
    // (the Class cookie correlates accounting rows to activation ids for
    // both hotspot and PPPoE sessions).
    const onlineRows = await db
        .selectDistinct({ userId: activatedPackages.userId })
        .from(radacct)
        .innerJoin(
            activatedPackages,
            sql`${radacct.class} = ${activatedPackages.id}::text`,
        )
        .where(
            and(
                inArray(activatedPackages.userId, userIds),
                isNull(radacct.acctstoptime),
                isNotNull(radacct.acctstarttime),
            ),
        );

    return {
        payments: new Map(
            paymentRows.map((r) => [
                r.userId,
                {
                    total: Number(r.total),
                    paid: Number(r.paid),
                    pending: Number(r.pending),
                    failed: Number(r.failed),
                    revenue: Number(r.revenue),
                },
            ]),
        ),
        activations: new Map(
            activationRows.map((r) => [
                r.userId,
                {
                    total: Number(r.total),
                    active: Number(r.active),
                    hotspot: Number(r.hotspot),
                    pppoe: Number(r.pppoe),
                },
            ]),
        ),
        flags: new Map(flagRows.map((r) => [r.userId, Number(r.total)])),
        online: new Set(onlineRows.map((r) => r.userId)),
        lastPayment: new Map(
            paymentRows.map((r) => [r.userId, r.lastAt]),
        ),
    };
}

export async function listAdminUsers(opts: ListAdminUsersOpts) {
    const page = Math.max(1, opts.page ?? 1);
    const perPage = Math.min(100, Math.max(1, opts.perPage ?? 50));

    const conditions = [];
    if (opts.q) {
        const q = `%${opts.q.trim()}%`;
        conditions.push(
            or(ilike(user.name, q), ilike(user.username, q), ilike(user.email, q)),
        );
    }
    if (opts.flagged) {
        conditions.push(
            exists(
                db
                    .select()
                    .from(userFlag)
                    .where(eq(userFlag.userId, user.id)),
            ),
        );
    }
    if (opts.type) {
        conditions.push(
            exists(
                db
                    .select()
                    .from(activatedPackages)
                    .innerJoin(
                        packages,
                        eq(activatedPackages.packageId, packages.id),
                    )
                    .where(
                        and(
                            eq(activatedPackages.userId, user.id),
                            eq(packages.type, opts.type!),
                        ),
                    ),
            ),
        );
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [stats] = await db
        .select({ total: count(user.id) })
        .from(user)
        .where(where);

    const users = await db
        .select()
        .from(user)
        .where(where)
        .orderBy(desc(user.createdAt))
        .limit(perPage)
        .offset((page - 1) * perPage);

    const agg = await userAggregates(users.map((u) => u.id));

    return {
        total: Number(stats.total),
        page,
        perPage,
        users: users.map((u) => {
            const payments = agg.payments.get(u.id);
            const activations = agg.activations.get(u.id);
            return {
                id: u.id,
                name: u.name,
                email: u.email,
                phoneNumber: u.username ?? '',
                image: u.image,
                role: u.role,
                banned: u.banned ?? false,
                banReason: u.banReason,
                createdAt: u.createdAt,
                flags: agg.flags.get(u.id) ?? 0,
                online: agg.online.has(u.id),
                payments: {
                    total: payments?.total ?? 0,
                    paid: payments?.paid ?? 0,
                    pending: payments?.pending ?? 0,
                    failed: payments?.failed ?? 0,
                    revenue: payments?.revenue ?? 0,
                },
                activations: {
                    total: activations?.total ?? 0,
                    active: activations?.active ?? 0,
                    hotspot: activations?.hotspot ?? 0,
                    pppoe: activations?.pppoe ?? 0,
                },
                lastPaymentAt: agg.lastPayment.get(u.id) ?? null,
            };
        }),
    };
}

// --- User valuation / detail --------------------------------------------------

// Everything the admin needs to appraise one customer: identity + moderation
// state, lifetime value figures, usage and their flag history.
export async function getAdminUserDetail(userId: string) {
    const [u] = await db
        .select()
        .from(user)
        .where(eq(user.id, userId))
        .limit(1);
    if (!u) return null;

    const agg = await userAggregates([userId]);
    const payments = agg.payments.get(userId);
    const activations = agg.activations.get(userId);

    const flags = await db
        .select({
            id: userFlag.id,
            reason: userFlag.reason,
            note: userFlag.note,
            createdAt: userFlag.createdAt,
            createdBy: userFlag.createdBy,
            creatorName: user.name,
        })
        .from(userFlag)
        .leftJoin(user, eq(userFlag.createdBy, user.id))
        .where(eq(userFlag.userId, userId))
        .orderBy(desc(userFlag.createdAt));

    const [firstPayment] = await db
        .select({ at: sql<Date>`min(${packagePayments.createdAt})` })
        .from(packagePayments)
        .where(
            and(
                eq(packagePayments.userId, userId),
                eq(packagePayments.status, 'paid'),
            ),
        );

    // Lifetime usage over every accounting record correlated to one of the
    // user's activations (Class cookie match covers hotspot + PPPoE).
    const [usage] = await db
        .select({
            sessions: count(radacct.radacctid),
            seconds: sql<number>`coalesce(sum(${radacct.acctsessiontime}), 0)::float8`,
            octets: sql<number>`coalesce(sum(coalesce(${radacct.acctinputoctets}, 0) + coalesce(${radacct.acctoutputoctets}, 0)), 0)::float8`,
            lastSeen: sql<Date | null>`max(coalesce(${radacct.acctupdatetime}, ${radacct.acctstarttime}))`,
        })
        .from(radacct)
        .where(
            sql`${radacct.class} in (select ${activatedPackages.id}::text from ${activatedPackages} where ${activatedPackages.userId} = ${userId})`,
        );

    return {
        id: u.id,
        name: u.name,
        email: u.email,
        phoneNumber: u.username ?? '',
        image: u.image,
        role: u.role,
        banned: u.banned ?? false,
        banReason: u.banReason,
        createdAt: u.createdAt,
        flags,
        payments: {
            total: payments?.total ?? 0,
            paid: payments?.paid ?? 0,
            pending: payments?.pending ?? 0,
            failed: payments?.failed ?? 0,
            revenue: payments?.revenue ?? 0,
            firstAt: firstPayment?.at ?? null,
            lastAt: agg.lastPayment.get(userId) ?? null,
        },
        activations: {
            total: activations?.total ?? 0,
            active: activations?.active ?? 0,
            hotspot: activations?.hotspot ?? 0,
            pppoe: activations?.pppoe ?? 0,
        },
        usage: {
            sessions: Number(usage?.sessions ?? 0),
            seconds: Number(usage?.seconds ?? 0),
            octets: Number(usage?.octets ?? 0),
            lastSeen: usage?.lastSeen ?? null,
        },
        online: agg.online.has(userId),
    };
}

// --- Flags --------------------------------------------------------------------

export async function addUserFlag(
    userId: string,
    createdBy: string,
    reason: string,
    note?: string,
) {
    const [flag] = await db
        .insert(userFlag)
        .values({
            userId,
            reason,
            note: note ?? null,
            createdBy,
        })
        .returning();
    return flag;
}

export async function removeUserFlag(flagId: string) {
    const removed = await db
        .delete(userFlag)
        .where(eq(userFlag.id, flagId))
        .returning();
    return removed.length > 0;
}

// --- Ban / unban ----------------------------------------------------------------

// better-auth honours these columns when resolving sessions: a banned user
// stops authenticating until un-banned.
export async function setUserBan(
    userId: string,
    banned: boolean,
    reason?: string,
    expiresAt?: Date | null,
) {
    const [row] = await db
        .update(user)
        .set({
            banned,
            banReason: banned ? (reason ?? null) : null,
            banExpires: banned ? (expiresAt ?? null) : null,
        })
        .where(eq(user.id, userId))
        .returning();
    return row ?? null;
}

// --- Payment log ----------------------------------------------------------------

export interface ListPaymentsOpts {
    status?: 'pending' | 'paid' | 'failed';
    // Matches payer phone, name or the provider's transaction code.
    q?: string;
    from?: Date;
    to?: Date;
    page?: number;
    perPage?: number;
}

export async function listPayments(opts: ListPaymentsOpts) {
    const page = Math.max(1, opts.page ?? 1);
    const perPage = Math.min(100, Math.max(1, opts.perPage ?? 50));

    const conditions = [];
    if (opts.status) conditions.push(eq(packagePayments.status, opts.status));
    if (opts.from) conditions.push(gte(packagePayments.createdAt, opts.from));
    if (opts.to) conditions.push(lte(packagePayments.createdAt, opts.to));
    if (opts.q) {
        const q = `%${opts.q.trim()}%`;
        conditions.push(
            or(
                ilike(packagePayments.phoneNumber, q),
                ilike(user.name, q),
                ilike(user.username, q),
                ilike(transaction.providerTransactionId, q),
            ),
        );
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [stats] = await db
        .select({
            total: count(packagePayments.id),
            paid: sql<number>`count(*) filter (where ${packagePayments.status} = 'paid')`,
            pending: sql<number>`count(*) filter (where ${packagePayments.status} = 'pending')`,
            failed: sql<number>`count(*) filter (where ${packagePayments.status} = 'failed')`,
            revenue: sql<number>`coalesce(sum(${packagePayments.amount}) filter (where ${packagePayments.status} = 'paid'), 0)::float8`,
        })
        .from(packagePayments)
        .leftJoin(user, eq(packagePayments.userId, user.id))
        .leftJoin(transaction, eq(packagePayments.transaction, transaction.id))
        .where(where);

    const rows = await db
        .select({
            id: packagePayments.id,
            userId: packagePayments.userId,
            userName: user.name,
            phoneNumber: packagePayments.phoneNumber,
            amount: packagePayments.amount,
            status: packagePayments.status,
            packageTitle: packages.title,
            packageType: packages.type,
            provider: transaction.provider,
            providerTransactionId: transaction.providerTransactionId,
            providerReference: transaction.providerReference,
            createdAt: packagePayments.createdAt,
            updatedAt: packagePayments.updatedAt,
        })
        .from(packagePayments)
        .leftJoin(user, eq(packagePayments.userId, user.id))
        .innerJoin(packages, eq(packagePayments.packageId, packages.id))
        .leftJoin(transaction, eq(packagePayments.transaction, transaction.id))
        .where(where)
        .orderBy(desc(packagePayments.createdAt))
        .limit(perPage)
        .offset((page - 1) * perPage);

    return {
        total: Number(stats.total),
        summary: {
            paid: Number(stats.paid),
            pending: Number(stats.pending),
            failed: Number(stats.failed),
            revenue: Number(stats.revenue),
        },
        page,
        perPage,
        payments: rows,
    };
}

// The full payment history of one user (the per-user payment log).
export async function getUserPayments(userId: string) {
    const rows = await db
        .select({
            id: packagePayments.id,
            amount: packagePayments.amount,
            status: packagePayments.status,
            phoneNumber: packagePayments.phoneNumber,
            packageTitle: packages.title,
            packageType: packages.type,
            provider: transaction.provider,
            providerTransactionId: transaction.providerTransactionId,
            createdAt: packagePayments.createdAt,
            updatedAt: packagePayments.updatedAt,
        })
        .from(packagePayments)
        .innerJoin(packages, eq(packagePayments.packageId, packages.id))
        .leftJoin(transaction, eq(packagePayments.transaction, transaction.id))
        .where(eq(packagePayments.userId, userId))
        .orderBy(desc(packagePayments.createdAt));
    return rows;
}

// --- Reports --------------------------------------------------------------------

export async function getAdminReports(from: Date, to: Date) {
    const inRange = and(
        gte(packagePayments.createdAt, from),
        lte(packagePayments.createdAt, to),
    );

    const daily = await db
        .select({
            day: sql<string>`to_char(${packagePayments.createdAt}, 'YYYY-MM-DD')`,
            paid: sql<number>`count(*) filter (where ${packagePayments.status} = 'paid')`,
            pending: sql<number>`count(*) filter (where ${packagePayments.status} = 'pending')`,
            failed: sql<number>`count(*) filter (where ${packagePayments.status} = 'failed')`,
            revenue: sql<number>`coalesce(sum(${packagePayments.amount}) filter (where ${packagePayments.status} = 'paid'), 0)::float8`,
        })
        .from(packagePayments)
        .where(inRange)
        .groupBy(sql`to_char(${packagePayments.createdAt}, 'YYYY-MM-DD')`)
        .orderBy(sql`to_char(${packagePayments.createdAt}, 'YYYY-MM-DD')`);

    const [totals] = await db
        .select({
            payments: count(packagePayments.id),
            revenue: sql<number>`coalesce(sum(${packagePayments.amount}) filter (where ${packagePayments.status} = 'paid'), 0)::float8`,
            buyers: sql<number>`count(distinct ${packagePayments.userId}) filter (where ${packagePayments.status} = 'paid')`,
        })
        .from(packagePayments)
        .where(inRange);

    const [newUsers] = await db
        .select({ total: count(user.id) })
        .from(user)
        .where(and(gte(user.createdAt, from), lte(user.createdAt, to)));

    const [newActivations] = await db
        .select({ total: count(activatedPackages.id) })
        .from(activatedPackages)
        .where(
            and(gte(activatedPackages.activatedAt, from), lte(activatedPackages.activatedAt, to)),
        );

    const topPackages = await db
        .select({
            packageId: packages.id,
            title: packages.title,
            type: packages.type,
            paid: count(packagePayments.id),
            revenue: sql<number>`coalesce(sum(${packagePayments.amount}), 0)::float8`,
        })
        .from(packagePayments)
        .innerJoin(packages, eq(packagePayments.packageId, packages.id))
        .where(and(inRange, eq(packagePayments.status, 'paid')))
        .groupBy(packages.id, packages.title, packages.type)
        .orderBy(desc(sql`sum(${packagePayments.amount})`))
        .limit(10);

    const topUsers = await db
        .select({
            userId: packagePayments.userId,
            userName: user.name,
            phoneNumber: user.username,
            paid: count(packagePayments.id),
            revenue: sql<number>`coalesce(sum(${packagePayments.amount}), 0)::float8`,
        })
        .from(packagePayments)
        .innerJoin(user, eq(packagePayments.userId, user.id))
        .where(and(inRange, eq(packagePayments.status, 'paid')))
        .groupBy(packagePayments.userId, user.name, user.username)
        .orderBy(desc(sql`sum(${packagePayments.amount})`))
        .limit(10);

    // Heaviest consumers by accounting volume in the range (username level).
    const topUsage = await db
        .select({
            username: radacct.username,
            sessions: count(radacct.radacctid),
            seconds: sql<number>`coalesce(sum(${radacct.acctsessiontime}), 0)::float8`,
            octets: sql<number>`coalesce(sum(coalesce(${radacct.acctinputoctets}, 0) + coalesce(${radacct.acctoutputoctets}, 0)), 0)::float8`,
        })
        .from(radacct)
        .where(
            and(
                isNotNull(radacct.acctstarttime),
                gte(radacct.acctstarttime, from),
                lte(radacct.acctstarttime, to),
            ),
        )
        .groupBy(radacct.username)
        .orderBy(
            desc(
                sql`sum(coalesce(${radacct.acctinputoctets}, 0) + coalesce(${radacct.acctoutputoctets}, 0))`,
            ),
        )
        .limit(10);

    return {
        totals: {
            payments: Number(totals.payments),
            revenue: Number(totals.revenue),
            buyers: Number(totals.buyers),
            newUsers: Number(newUsers.total),
            newActivations: Number(newActivations.total),
        },
        daily: daily.map((d) => ({
            day: d.day,
            paid: Number(d.paid),
            pending: Number(d.pending),
            failed: Number(d.failed),
            revenue: Number(d.revenue),
        })),
        topPackages: topPackages.map((p) => ({
            packageId: p.packageId,
            title: p.title,
            type: p.type,
            paid: Number(p.paid),
            revenue: Number(p.revenue),
        })),
        topUsers: topUsers.map((u) => ({
            userId: u.userId,
            userName: u.userName,
            phoneNumber: u.phoneNumber ?? '',
            paid: Number(u.paid),
            revenue: Number(u.revenue),
        })),
        topUsage: topUsage.map((u) => ({
            username: u.username ?? '',
            sessions: Number(u.sessions),
            seconds: Number(u.seconds),
            octets: Number(u.octets),
        })),
    };
}
