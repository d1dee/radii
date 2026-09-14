// Admin customer (hotspot/PPPoE user) management queries: listing with
// aggregates, per-user valuation detail, the global payment log and reporting
// data. Users come from the better-auth `user` table; everything else is
// joined from the domain tables (payments, activations, flags, accounting).
//
// Every query here is TENANT-SCOPED to the requesting admin: customers are
// only visible when they interacted with one of the admin's NAS devices —
// a payment stamped with one of them (package_payments.nas_device_id, set at
// order time) or a hotspot portal login request on one. Admins never see
// each other's customers, payments or reports.

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
    type SQL,
} from 'drizzle-orm';
import { db } from '../db';
import {
    activatedPackages,
    activationEvents,
    adminUser,
    hotspotLoginRequest,
    nasDevice,
    nasSetupScript,
    packagePayments,
    packages,
    radacct,
    transaction,
    transactionLog,
    user,
    userFlag,
} from '../db/schema';
import { calculateActivationTime } from './radius/activationLimits';

export type AdminUserTypeFilter = 'hotspot' | 'pppoe';

// --- Tenant scoping ---------------------------------------------------------

// Correlated condition on the `user` table: the customer interacted with any
// of the admin's NAS devices (a payment attributed to one, or a hotspot login
// request on one — the latter also captures customers who reached the captive
// portal without paying).
export function customerVisibleToAdmin(adminId: string): SQL {
    return or(
        exists(
            db
                .select({ one: sql`1` })
                .from(packagePayments)
                .innerJoin(
                    nasDevice,
                    eq(packagePayments.nasDeviceId, nasDevice.id),
                )
                .where(
                    and(
                        eq(packagePayments.userId, user.id),
                        eq(nasDevice.ownerId, adminId),
                    ),
                ),
        ),
        exists(
            db
                .select({ one: sql`1` })
                .from(hotspotLoginRequest)
                .innerJoin(
                    nasDevice,
                    eq(hotspotLoginRequest.nasDeviceId, nasDevice.id),
                )
                .where(
                    and(
                        eq(hotspotLoginRequest.userId, user.id),
                        eq(nasDevice.ownerId, adminId),
                    ),
                ),
        ),
    ) as SQL;
}

// Lightweight visibility check for guarding single-customer admin endpoints.
export async function isAdminUserVisible(
    adminId: string,
    userId: string,
): Promise<boolean> {
    const rows = await db
        .select({ id: user.id })
        .from(user)
        .where(and(eq(user.id, userId), customerVisibleToAdmin(adminId)))
        .limit(1);
    return rows.length > 0;
}

async function getUserAdminIds(userId: string): Promise<Set<string>> {
    const [paymentOwners, loginOwners] = await Promise.all([
        db
            .selectDistinct({ ownerId: nasDevice.ownerId })
            .from(packagePayments)
            .innerJoin(nasDevice, eq(packagePayments.nasDeviceId, nasDevice.id))
            .where(eq(packagePayments.userId, userId)),
        db
            .selectDistinct({ ownerId: nasDevice.ownerId })
            .from(hotspotLoginRequest)
            .innerJoin(
                nasDevice,
                eq(hotspotLoginRequest.nasDeviceId, nasDevice.id),
            )
            .where(eq(hotspotLoginRequest.userId, userId)),
    ]);
    return new Set(
        [...paymentOwners, ...loginOwners].map((row) => row.ownerId),
    );
}

// Global better-auth bans are safe for a tenant admin only when the customer
// has no relationship with another tenant.
export async function canAdminManageGlobalUser(
    adminId: string,
    userId: string,
): Promise<boolean> {
    const owners = await getUserAdminIds(userId);
    return owners.size === 1 && owners.has(adminId);
}

// PPPoE currently uses one stable account per customer. Until credentials are
// tenant-specific, prevent one admin from reading or rotating an account used
// by another admin's PPPoE activation.
export async function canAdminManagePppoeAccount(
    adminId: string,
    userId: string,
): Promise<boolean> {
    const rows = await db
        .selectDistinct({ ownerId: nasDevice.ownerId })
        .from(activatedPackages)
        .innerJoin(packages, eq(activatedPackages.packageId, packages.id))
        .innerJoin(
            packagePayments,
            eq(activatedPackages.packagePaymentId, packagePayments.id),
        )
        .innerJoin(nasDevice, eq(packagePayments.nasDeviceId, nasDevice.id))
        .where(
            and(
                eq(activatedPackages.userId, userId),
                eq(packages.type, 'pppoe'),
            ),
        );
    const owners = new Set(rows.map((row) => row.ownerId));
    return owners.size === 1 && owners.has(adminId);
}

// Payments attributed to one of the admin's NAS devices (join used across the
// scoped aggregates, payment log and reports).
function scopedToAdminNas(adminId: string): SQL {
    return eq(nasDevice.ownerId, adminId);
}

// Accounting tenancy follows the NAS that emitted the row. An address is
// usable as an authorization boundary only when no other admin has registered
// the same direct or WireGuard address.
function scopedAccountingToAdminNas(adminId: string): SQL {
    return sql`${radacct.nasipaddress} in (
        select owned.ip_address from nas_device owned
        where owned.owner_id = ${adminId}
        union
        select owned_setup.wg_client_ip
        from nas_setup_script owned_setup
        inner join nas_device owned on owned.id = owned_setup.nas_device_id
        where owned.owner_id = ${adminId}
    ) and not exists (
        select 1
        from nas_device other
        left join nas_setup_script other_setup on other_setup.nas_device_id = other.id
        where other.owner_id <> ${adminId}
          and (${radacct.nasipaddress} = other.ip_address
               or ${radacct.nasipaddress} = other_setup.wg_client_ip)
    )`;
}

// --- User listing -----------------------------------------------------------

export interface ListAdminUsersOpts {
    // The requesting admin; customers are scoped to their NAS devices.
    adminId: string;
    // Matches name, phone (username) or email.
    q?: string;
    // Only users with at least one activation of this package type.
    type?: AdminUserTypeFilter;
    // Only users carrying at least one flag raised by this admin.
    flagged?: boolean;
    page?: number;
    perPage?: number;
}

async function userAggregates(userIds: string[], adminId: string) {
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
                {
                    total: number;
                    active: number;
                    hotspot: number;
                    pppoe: number;
                }
            >(),
            flags: new Map<string, number>(),
            online: new Set<string>(),
            lastPayment: new Map<string, Date>(),
        };
    }

    // Only payments attributed to the admin's NAS devices count towards a
    // customer's value here (tenant isolation).
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
        .innerJoin(nasDevice, eq(packagePayments.nasDeviceId, nasDevice.id))
        .where(
            and(
                inArray(packagePayments.userId, userIds),
                scopedToAdminNas(adminId),
            ),
        )
        .groupBy(packagePayments.userId);

    // Activations inherit the tenant from the payment that created them.
    const activationRows = await db
        .select({
            userId: activatedPackages.userId,
            total: count(activatedPackages.id),
            active: sql<number>`count(*) filter (where ${activatedPackages.expireAt} > now() and ${activatedPackages.deactivatedAt} is null)`,
            hotspot: sql<number>`count(*) filter (where ${packages.type} = 'hotspot')`,
            pppoe: sql<number>`count(*) filter (where ${packages.type} = 'pppoe')`,
        })
        .from(activatedPackages)
        .innerJoin(packages, eq(activatedPackages.packageId, packages.id))
        .innerJoin(
            packagePayments,
            eq(activatedPackages.packagePaymentId, packagePayments.id),
        )
        .innerJoin(nasDevice, eq(packagePayments.nasDeviceId, nasDevice.id))
        .where(
            and(
                inArray(activatedPackages.userId, userIds),
                scopedToAdminNas(adminId),
            ),
        )
        .groupBy(activatedPackages.userId);

    // Flags are per-admin moderation state: only this admin's flags count.
    const flagRows = await db
        .select({
            userId: userFlag.userId,
            total: count(userFlag.id),
        })
        .from(userFlag)
        .where(
            and(
                inArray(userFlag.userId, userIds),
                eq(userFlag.createdBy, adminId),
            ),
        )
        .groupBy(userFlag.userId);

    // Online now: a live accounting record of any of the user's activations
    // on the admin's network (the Class cookie correlates accounting rows to
    // activation ids for both hotspot and PPPoE sessions).
    const onlineRows = await db
        .selectDistinct({ userId: activatedPackages.userId })
        .from(radacct)
        .innerJoin(
            activatedPackages,
            sql`${radacct.class} = ${activatedPackages.id}::text`,
        )
        .innerJoin(
            packagePayments,
            eq(activatedPackages.packagePaymentId, packagePayments.id),
        )
        .innerJoin(nasDevice, eq(packagePayments.nasDeviceId, nasDevice.id))
        .where(
            and(
                inArray(activatedPackages.userId, userIds),
                scopedToAdminNas(adminId),
                scopedAccountingToAdminNas(adminId),
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
        lastPayment: new Map(paymentRows.map((r) => [r.userId, r.lastAt])),
    };
}

export async function listAdminUsers(opts: ListAdminUsersOpts) {
    const page = Math.max(1, opts.page ?? 1);
    const perPage = Math.min(100, Math.max(1, opts.perPage ?? 50));

    // Tenant scope first: only customers who interacted with this admin's
    // NAS devices are ever listed, regardless of other filters.
    const conditions = [customerVisibleToAdmin(opts.adminId)];
    if (opts.q) {
        const q = `%${opts.q.trim()}%`;
        conditions.push(
            or(
                ilike(user.name, q),
                ilike(user.username, q),
                ilike(user.email, q),
            )!,
        );
    }
    if (opts.flagged) {
        conditions.push(
            exists(
                db
                    .select()
                    .from(userFlag)
                    .where(
                        and(
                            eq(userFlag.userId, user.id),
                            eq(userFlag.createdBy, opts.adminId),
                        ),
                    ),
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
                    .innerJoin(
                        packagePayments,
                        eq(
                            activatedPackages.packagePaymentId,
                            packagePayments.id,
                        ),
                    )
                    .innerJoin(
                        nasDevice,
                        eq(packagePayments.nasDeviceId, nasDevice.id),
                    )
                    .where(
                        and(
                            eq(activatedPackages.userId, user.id),
                            eq(packages.type, opts.type!),
                            eq(nasDevice.ownerId, opts.adminId),
                        ),
                    ),
            ),
        );
    }
    const where = and(...conditions);

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

    const agg = await userAggregates(
        users.map((u) => u.id),
        opts.adminId,
    );

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
// state, lifetime value figures, usage and their flag history. Returns null
// when the customer never interacted with the admin's NAS devices — the same
// 404 an unknown id produces, so visibility is not enumerable. All figures
// are scoped to the admin's network (tenant isolation).
export async function getAdminUserDetail(userId: string, adminId: string) {
    const [u] = await db
        .select()
        .from(user)
        .where(and(eq(user.id, userId), customerVisibleToAdmin(adminId)))
        .limit(1);
    if (!u) return null;

    const agg = await userAggregates([userId], adminId);
    const payments = agg.payments.get(userId);
    const activations = agg.activations.get(userId);

    // Flag creators are admins from the isolated admin auth instance
    // (admin_user), not customers from the `user` table. Only this admin's
    // own flags are exposed.
    const flags = await db
        .select({
            id: userFlag.id,
            reason: userFlag.reason,
            note: userFlag.note,
            createdAt: userFlag.createdAt,
            createdBy: userFlag.createdBy,
            creatorName: adminUser.name,
        })
        .from(userFlag)
        .leftJoin(adminUser, eq(userFlag.createdBy, adminUser.id))
        .where(
            and(eq(userFlag.userId, userId), eq(userFlag.createdBy, adminId)),
        )
        .orderBy(desc(userFlag.createdAt));

    const [firstPayment] = await db
        .select({ at: sql<Date>`min(${packagePayments.createdAt})` })
        .from(packagePayments)
        .innerJoin(nasDevice, eq(packagePayments.nasDeviceId, nasDevice.id))
        .where(
            and(
                eq(packagePayments.userId, userId),
                eq(packagePayments.status, 'paid'),
                scopedToAdminNas(adminId),
            ),
        );

    // Lifetime usage over every accounting record correlated to one of the
    // user's activations on the admin's network (Class cookie match covers
    // hotspot + PPPoE; the activation's payment carries the tenant).
    const [usage] = await db
        .select({
            sessions: count(radacct.radacctid),
            seconds: sql<number>`coalesce(sum(${radacct.acctsessiontime}), 0)::float8`,
            octets: sql<number>`coalesce(sum(coalesce(${radacct.acctinputoctets}, 0) + coalesce(${radacct.acctoutputoctets}, 0)), 0)::float8`,
            lastSeen: sql<Date | null>`max(coalesce(${radacct.acctupdatetime}, ${radacct.acctstarttime}))`,
        })
        .from(radacct)
        .where(
            and(
                sql`${radacct.class} in (
                select ${activatedPackages.id}::text
                from ${activatedPackages}
                inner join ${packagePayments} on ${packagePayments.id} = ${activatedPackages.packagePaymentId}
                inner join ${nasDevice} on ${nasDevice.id} = ${packagePayments.nasDeviceId}
                where ${activatedPackages.userId} = ${userId} and ${nasDevice.ownerId} = ${adminId}
                )`,
                scopedAccountingToAdminNas(adminId),
            ),
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

// Activation ids on the admin's network for one customer. Used to filter the
// RADIUS client's per-user activation view: the phone account is global, so
// without this an admin would see activations the customer made on other
// admins' networks.
export async function getOwnedActivationIds(
    adminId: string,
    userId: string,
): Promise<string[]> {
    const rows = await db
        .select({ id: activatedPackages.id })
        .from(activatedPackages)
        .innerJoin(
            packagePayments,
            eq(activatedPackages.packagePaymentId, packagePayments.id),
        )
        .innerJoin(nasDevice, eq(packagePayments.nasDeviceId, nasDevice.id))
        .where(
            and(
                eq(activatedPackages.userId, userId),
                eq(nasDevice.ownerId, adminId),
            ),
        );
    return rows.map((r) => r.id);
}

// Whether one activation was issued on the admin's network
// (activation -> payment -> NAS -> owner). Guards the activation-scoped
// admin endpoints (status, activate, deactivate, expiry edits).
export async function isAdminActivationVisible(
    adminId: string,
    activationId: string,
): Promise<boolean> {
    const rows = await db
        .select({ id: activatedPackages.id })
        .from(activatedPackages)
        .innerJoin(
            packagePayments,
            eq(activatedPackages.packagePaymentId, packagePayments.id),
        )
        .innerJoin(nasDevice, eq(packagePayments.nasDeviceId, nasDevice.id))
        .where(
            and(
                eq(activatedPackages.id, activationId),
                eq(nasDevice.ownerId, adminId),
            ),
        )
        .limit(1);
    return rows.length > 0;
}

export async function canAdminManageActivation(
    adminId: string,
    activationId: string,
): Promise<boolean> {
    const [row] = await db
        .select({ userId: activatedPackages.userId, type: packages.type })
        .from(activatedPackages)
        .innerJoin(packages, eq(activatedPackages.packageId, packages.id))
        .innerJoin(
            packagePayments,
            eq(activatedPackages.packagePaymentId, packagePayments.id),
        )
        .innerJoin(nasDevice, eq(packagePayments.nasDeviceId, nasDevice.id))
        .where(
            and(
                eq(activatedPackages.id, activationId),
                eq(nasDevice.ownerId, adminId),
            ),
        )
        .limit(1);
    if (!row) return false;
    return row.type !== 'pppoe'
        ? true
        : canAdminManagePppoeAccount(adminId, row.userId);
}

function scopedSessionToAdminNas(adminId: string): SQL {
    return and(
        eq(nasDevice.ownerId, adminId),
        or(
            eq(radacct.nasipaddress, nasDevice.ipAddress),
            eq(radacct.nasipaddress, nasSetupScript.wgClientIp),
        ),
        scopedAccountingToAdminNas(adminId),
    ) as SQL;
}

// Session operations are authorized against the NAS that actually emitted the
// accounting row. Class is business correlation data, not the tenant boundary.
export async function isAdminRadacctVisible(
    adminId: string,
    radacctId: string,
): Promise<boolean> {
    const [row] = await db
        .select({ id: radacct.radacctid })
        .from(radacct)
        .innerJoin(nasDevice, eq(nasDevice.ownerId, adminId))
        .leftJoin(nasSetupScript, eq(nasSetupScript.nasDeviceId, nasDevice.id))
        .where(
            and(
                eq(radacct.radacctid, BigInt(radacctId)),
                isNotNull(radacct.acctstarttime),
                scopedSessionToAdminNas(adminId),
            ),
        )
        .limit(1);
    return Boolean(row);
}

// Every IP address the admin's NAS devices can appear under in accounting
// records: the directly reachable address and the WireGuard tunnel client
// address (RADIUS packets may carry either as NAS-IP-Address). Used to
// filter cross-NAS listings without touching the RADIUS client.
export async function getAdminNasAddresses(
    adminId: string,
    nasDeviceId?: string,
): Promise<Set<string>> {
    const rows = await db
        .select({
            ownerId: nasDevice.ownerId,
            ip: nasDevice.ipAddress,
            wgIp: nasSetupScript.wgClientIp,
        })
        .from(nasDevice)
        .leftJoin(nasSetupScript, eq(nasSetupScript.nasDeviceId, nasDevice.id));
    const ownersByIp = new Map<string, Set<string>>();
    for (const r of rows) {
        for (const value of [r.ip, r.wgIp]) {
            if (!value) continue;
            const ip = value.replace(/\/\d+$/, '');
            const owners = ownersByIp.get(ip) ?? new Set<string>();
            owners.add(r.ownerId);
            ownersByIp.set(ip, owners);
        }
    }
    const targetAddresses = new Set(
        rows
            .filter((row) => row.ownerId === adminId)
            .flatMap((row) => [row.ip, row.wgIp])
            .filter((value): value is string => Boolean(value))
            .map((value) => value.replace(/\/\d+$/, '')),
    );
    if (nasDeviceId) {
        const [target] = await db
            .select({
                ip: nasDevice.ipAddress,
                wgIp: nasSetupScript.wgClientIp,
            })
            .from(nasDevice)
            .leftJoin(
                nasSetupScript,
                eq(nasSetupScript.nasDeviceId, nasDevice.id),
            )
            .where(
                and(
                    eq(nasDevice.id, nasDeviceId),
                    eq(nasDevice.ownerId, adminId),
                ),
            )
            .limit(1);
        targetAddresses.clear();
        for (const value of [target?.ip, target?.wgIp]) {
            if (value) targetAddresses.add(value.replace(/\/\d+$/, ''));
        }
    }
    return new Set(
        [...ownersByIp.entries()].flatMap(([ip, owners]) =>
            owners.size === 1 && owners.has(adminId) && targetAddresses.has(ip)
                ? [ip]
                : [],
        ),
    );
}

export async function getAdminSessionDetail(
    adminId: string,
    radacctId: string,
) {
    const [row] = await db
        .select({
            accounting: radacct,
            nasDevice: {
                id: nasDevice.id,
                name: nasDevice.name,
                ipAddress: nasDevice.ipAddress,
                model: nasDevice.model,
                location: nasDevice.location,
            },
            activation: {
                id: activatedPackages.id,
                activatedAt: activatedPackages.activatedAt,
                expireAt: activatedPackages.expireAt,
                deactivatedAt: activatedPackages.deactivatedAt,
                timeAllowanceSeconds: activatedPackages.timeAllowanceSeconds,
            },
            packageSessionLength: packages.sessionLength,
            packageNoExpiry: packages.noExpiry,
            customer: {
                id: user.id,
                name: user.name,
                phoneNumber: user.username,
            },
            payment: {
                id: packagePayments.id,
                status: packagePayments.status,
                amount: packagePayments.amount,
                createdAt: packagePayments.createdAt,
            },
            package: {
                id: packages.id,
                title: packages.title,
                type: packages.type,
                category: packages.category,
            },
        })
        .from(radacct)
        .innerJoin(nasDevice, eq(nasDevice.ownerId, adminId))
        .leftJoin(nasSetupScript, eq(nasSetupScript.nasDeviceId, nasDevice.id))
        .leftJoin(
            activatedPackages,
            and(
                sql`${radacct.class} = ${activatedPackages.id}::text`,
                sql`exists (
                    select 1
                    from package_payments activation_payment
                    inner join nas_device activation_nas
                        on activation_nas.id = activation_payment.nas_device_id
                    where activation_payment.id = ${activatedPackages.packagePaymentId}
                      and activation_nas.owner_id = ${adminId}
                )`,
            ),
        )
        .leftJoin(
            packagePayments,
            and(
                eq(activatedPackages.packagePaymentId, packagePayments.id),
                eq(activatedPackages.userId, packagePayments.userId),
                eq(activatedPackages.packageId, packagePayments.packageId),
            ),
        )
        .leftJoin(user, eq(packagePayments.userId, user.id))
        .leftJoin(packages, eq(packagePayments.packageId, packages.id))
        .where(
            and(
                eq(radacct.radacctid, BigInt(radacctId)),
                isNotNull(radacct.acctstarttime),
                scopedSessionToAdminNas(adminId),
            ),
        )
        .limit(1);

    if (!row) return null;

    const inputOctets = Number(row.accounting.acctinputoctets ?? 0);
    const outputOctets = Number(row.accounting.acctoutputoctets ?? 0);
    const live = row.accounting.acctstoptime === null;
    const seconds = live
        ? Math.max(
              0,
              (Date.now() - row.accounting.acctstarttime!.getTime()) / 1000,
          )
        : Number(row.accounting.acctsessiontime ?? 0);

    let activationDetail = null;
    if (row.activation?.id) {
        const activationId = row.activation.id;
        const nasAddresses = [...(await getAdminNasAddresses(adminId))];
        const [events, accountingRows] = await Promise.all([
            db
                .select()
                .from(activationEvents)
                .where(eq(activationEvents.activationId, activationId))
                .orderBy(desc(activationEvents.createdAt)),
            nasAddresses.length > 0
                ? db
                      .select()
                      .from(radacct)
                      .where(
                          and(
                              eq(radacct.class, activationId),
                              isNotNull(radacct.acctstarttime),
                              inArray(radacct.nasipaddress, nasAddresses),
                          ),
                      )
                      .orderBy(desc(radacct.acctstarttime))
                : Promise.resolve([]),
        ]);

        const adminActorIds = events.flatMap((event) =>
            event.actorType === 'admin' && event.actorId ? [event.actorId] : [],
        );
        const customerActorIds = events.flatMap((event) =>
            event.actorType === 'customer' && event.actorId
                ? [event.actorId]
                : [],
        );
        const [adminActors, customerActors] = await Promise.all([
            adminActorIds.length
                ? db
                      .select({ id: adminUser.id, name: adminUser.name })
                      .from(adminUser)
                      .where(inArray(adminUser.id, adminActorIds))
                : Promise.resolve([]),
            customerActorIds.length
                ? db
                      .select({ id: user.id, name: user.name })
                      .from(user)
                      .where(inArray(user.id, customerActorIds))
                : Promise.resolve([]),
        ]);
        const actorNames = new Map(
            [...adminActors, ...customerActors].map((actor) => [
                actor.id,
                actor.name,
            ]),
        );

        const consumption = accountingRows.map((accounting) => {
            const sessionLive = accounting.acctstoptime === null;
            const sessionSeconds = sessionLive
                ? Math.max(
                      0,
                      (Date.now() - accounting.acctstarttime!.getTime()) / 1000,
                  )
                : Number(accounting.acctsessiontime ?? 0);
            const sessionInputOctets = Number(accounting.acctinputoctets ?? 0);
            const sessionOutputOctets = Number(
                accounting.acctoutputoctets ?? 0,
            );
            return {
                radacctId: String(accounting.radacctid),
                acctSessionId: accounting.acctsessionid,
                startedAt: accounting.acctstarttime!,
                stoppedAt: accounting.acctstoptime,
                live: sessionLive,
                seconds: Math.round(sessionSeconds),
                inputOctets: sessionInputOctets,
                outputOctets: sessionOutputOctets,
                totalOctets: sessionInputOctets + sessionOutputOctets,
                callingStationId: accounting.callingstationid,
                framedIpAddress: accounting.framedipaddress,
                terminateCause: accounting.acctterminatecause,
            };
        });
        const usedSeconds = consumption.reduce(
            (total, item) => total + item.seconds,
            0,
        );
        const packageAllowanceSeconds = (row.packageSessionLength ?? 0) * 60;
        const cumulative =
            Boolean(row.packageNoExpiry) ||
            row.activation.timeAllowanceSeconds !== null;
        const balance = calculateActivationTime({
            activatedAt: row.activation.activatedAt!,
            expireAt: row.activation.expireAt!,
            packageAllowanceSeconds,
            allowanceOverrideSeconds: row.activation.timeAllowanceSeconds,
            usedSeconds,
            cumulative: Boolean(row.packageNoExpiry),
            now: new Date(),
        });

        activationDetail = {
            ...row.activation,
            balance: {
                mode: cumulative
                    ? ('cumulative' as const)
                    : ('calendar' as const),
                totalSeconds: balance.sessionLimitSeconds,
                usedSeconds,
                remainingSeconds: balance.remainingSeconds,
            },
            events: events.map((event) => ({
                id: event.id,
                type: event.eventType,
                actor: {
                    type: event.actorType,
                    id: event.actorId,
                    label:
                        (event.actorId && actorNames.get(event.actorId)) ||
                        (event.actorType === 'system'
                            ? 'System'
                            : event.actorType === 'admin'
                              ? 'Administrator'
                              : 'Customer'),
                },
                source: event.source,
                metadata: event.metadata,
                createdAt: event.createdAt,
            })),
            consumption,
        };
    }

    return {
        session: {
            radacctId: String(row.accounting.radacctid),
            acctSessionId: row.accounting.acctsessionid,
            acctUniqueId: row.accounting.acctuniqueid,
            username: row.accounting.username ?? '',
            realm: row.accounting.realm,
            nasIpAddress: row.accounting.nasipaddress,
            nasPortId: row.accounting.nasportid,
            nasPortType: row.accounting.nasporttype,
            serviceType: row.accounting.servicetype,
            framedProtocol: row.accounting.framedprotocol,
            callingStationId: row.accounting.callingstationid,
            calledStationId: row.accounting.calledstationid,
            framedIpAddress: row.accounting.framedipaddress,
            startedAt: row.accounting.acctstarttime,
            updatedAt: row.accounting.acctupdatetime,
            stoppedAt: row.accounting.acctstoptime,
            terminateCause: row.accounting.acctterminatecause,
            connectInfoStart: row.accounting.connectinfoStart,
            connectInfoStop: row.accounting.connectinfoStop,
            live,
            seconds: Math.round(seconds),
            inputOctets,
            outputOctets,
            totalOctets: inputOctets + outputOctets,
            avgSpeedBps:
                seconds > 0
                    ? Math.round(((inputOctets + outputOctets) * 8) / seconds)
                    : 0,
        },
        nasDevice: row.nasDevice,
        activation: activationDetail,
        customer: row.customer?.id ? row.customer : null,
        payment: row.payment?.id ? row.payment : null,
        package: row.package?.id ? row.package : null,
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

// Only the flag's authoring admin can remove it (tenant-scoped moderation).
export async function removeUserFlag(flagId: string, adminId: string) {
    const removed = await db
        .delete(userFlag)
        .where(and(eq(userFlag.id, flagId), eq(userFlag.createdBy, adminId)))
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
    // The requesting admin; only payments attributed to their NAS devices
    // are listed.
    adminId: string;
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

    // Tenant scope: payments stamped with one of the admin's NAS devices.
    const conditions = [scopedToAdminNas(opts.adminId)];
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
            )!,
        );
    }
    const where = and(...conditions);

    const [stats] = await db
        .select({
            total: count(packagePayments.id),
            paid: sql<number>`count(*) filter (where ${packagePayments.status} = 'paid')`,
            pending: sql<number>`count(*) filter (where ${packagePayments.status} = 'pending')`,
            failed: sql<number>`count(*) filter (where ${packagePayments.status} = 'failed')`,
            revenue: sql<number>`coalesce(sum(${packagePayments.amount}) filter (where ${packagePayments.status} = 'paid'), 0)::float8`,
        })
        .from(packagePayments)
        .innerJoin(nasDevice, eq(packagePayments.nasDeviceId, nasDevice.id))
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
        .innerJoin(nasDevice, eq(packagePayments.nasDeviceId, nasDevice.id))
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

type PaymentEventDetails = {
    resultCode: string | null;
    message: string | null;
    amount: number | null;
    receipt: string | null;
    transactionDate: string | null;
    transactionStatus: string | null;
};

function record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : null;
}

function stringValue(value: unknown): string | null {
    return typeof value === 'string' || typeof value === 'number'
        ? String(value)
        : null;
}

// Provider payloads are stored verbatim for diagnostics. Only copy the small
// reconciliation allowlist below into admin responses; names, phone numbers,
// account data, arbitrary metadata and the raw payload never leave the API.
function sanitizePaymentEvent(payload: unknown): PaymentEventDetails {
    const root = record(payload);
    const stk = record(record(root?.Body)?.stkCallback);
    const result = record(root?.Result);
    const callbackMetadataRoot = record(stk?.CallbackMetadata);
    const resultParametersRoot = record(result?.ResultParameters);
    const callbackItems = Array.isArray(callbackMetadataRoot?.Item)
        ? (callbackMetadataRoot.Item as unknown[])
        : [];
    const resultItems = Array.isArray(resultParametersRoot?.ResultParameter)
        ? (resultParametersRoot.ResultParameter as unknown[])
        : [];
    const callbackMetadata = Object.fromEntries(
        callbackItems.flatMap((item) => {
            const row = record(item);
            return typeof row?.Name === 'string' ? [[row.Name, row.Value]] : [];
        }),
    );
    const resultParameters = Object.fromEntries(
        resultItems.flatMap((item) => {
            const row = record(item);
            return typeof row?.Key === 'string' ? [[row.Key, row.Value]] : [];
        }),
    );
    const amountValue = callbackMetadata.Amount ?? resultParameters.Amount;
    const amount = Number(amountValue);

    return {
        resultCode: stringValue(stk?.ResultCode ?? result?.ResultCode),
        message: stringValue(
            stk?.ResultDesc ?? result?.ResultDesc ?? root?.message,
        ),
        amount: Number.isFinite(amount) ? amount : null,
        receipt: stringValue(
            callbackMetadata.MpesaReceiptNumber ??
                resultParameters.ReceiptNo ??
                result?.TransactionID,
        ),
        transactionDate: stringValue(
            callbackMetadata.TransactionDate ?? resultParameters.FinalisedTime,
        ),
        transactionStatus: stringValue(resultParameters.TransactionStatus),
    };
}

export async function getAdminPaymentDetail(
    paymentId: string,
    adminId: string,
) {
    const [payment] = await db
        .select({
            id: packagePayments.id,
            userName: user.name,
            phoneNumber: packagePayments.phoneNumber,
            amount: packagePayments.amount,
            status: packagePayments.status,
            packageTitle: packages.title,
            packageType: packages.type,
            nasDeviceName: nasDevice.name,
            provider: transaction.provider,
            providerTransactionId: transaction.providerTransactionId,
            providerReference: transaction.providerReference,
            transactionId: transaction.id,
            transactionStatus: transaction.status,
            currency: transaction.currency,
            description: transaction.description,
            createdAt: packagePayments.createdAt,
            updatedAt: packagePayments.updatedAt,
        })
        .from(packagePayments)
        .innerJoin(nasDevice, eq(packagePayments.nasDeviceId, nasDevice.id))
        .leftJoin(user, eq(packagePayments.userId, user.id))
        .innerJoin(packages, eq(packagePayments.packageId, packages.id))
        .leftJoin(transaction, eq(packagePayments.transaction, transaction.id))
        .where(
            and(eq(packagePayments.id, paymentId), scopedToAdminNas(adminId)),
        )
        .limit(1);

    if (!payment) return null;

    const logs = payment.transactionId
        ? await db
              .select({
                  id: transactionLog.id,
                  provider: transactionLog.provider,
                  eventType: transactionLog.eventType,
                  payload: transactionLog.payload,
                  providerRequestId: transactionLog.providerRequestId,
                  providerConversationId: transactionLog.providerConversationId,
                  createdAt: transactionLog.createdAt,
              })
              .from(transactionLog)
              .where(eq(transactionLog.transactionId, payment.transactionId))
              .orderBy(desc(transactionLog.createdAt))
        : [];

    const { transactionId: _, ...detail } = payment;
    return {
        ...detail,
        events: logs.map(({ payload, ...log }) => ({
            ...log,
            ...sanitizePaymentEvent(payload),
        })),
    };
}

// The payment history of one user on the admin's network (the per-user
// payment log).
export async function getUserPayments(userId: string, adminId: string) {
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
        .innerJoin(nasDevice, eq(packagePayments.nasDeviceId, nasDevice.id))
        .leftJoin(transaction, eq(packagePayments.transaction, transaction.id))
        .where(
            and(eq(packagePayments.userId, userId), scopedToAdminNas(adminId)),
        )
        .orderBy(desc(packagePayments.createdAt));
    return rows;
}

// --- Reports --------------------------------------------------------------------

export async function getAdminReports(adminId: string, from: Date, to: Date) {
    // Every figure below covers only the admin's network: payments are
    // filtered through their stamped NAS device, activations through the
    // payment that created them, and new customers through the visibility
    // interaction rule.
    const inRange = and(
        gte(packagePayments.createdAt, from),
        lte(packagePayments.createdAt, to),
        scopedToAdminNas(adminId),
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
        .innerJoin(nasDevice, eq(packagePayments.nasDeviceId, nasDevice.id))
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
        .innerJoin(nasDevice, eq(packagePayments.nasDeviceId, nasDevice.id))
        .where(inRange);

    const [newUsers] = await db
        .select({ total: count(user.id) })
        .from(user)
        .where(
            and(
                gte(user.createdAt, from),
                lte(user.createdAt, to),
                customerVisibleToAdmin(adminId),
            ),
        );

    const [newActivations] = await db
        .select({ total: count(activatedPackages.id) })
        .from(activatedPackages)
        .innerJoin(
            packagePayments,
            eq(activatedPackages.packagePaymentId, packagePayments.id),
        )
        .innerJoin(nasDevice, eq(packagePayments.nasDeviceId, nasDevice.id))
        .where(
            and(
                gte(activatedPackages.activatedAt, from),
                lte(activatedPackages.activatedAt, to),
                scopedToAdminNas(adminId),
            ),
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
        .innerJoin(nasDevice, eq(packagePayments.nasDeviceId, nasDevice.id))
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
        .innerJoin(nasDevice, eq(packagePayments.nasDeviceId, nasDevice.id))
        .where(and(inRange, eq(packagePayments.status, 'paid')))
        .groupBy(packagePayments.userId, user.name, user.username)
        .orderBy(desc(sql`sum(${packagePayments.amount})`))
        .limit(10);

    // Heaviest consumers on the admin's network by accounting volume in the
    // range (username level; activation Class cookie carries the tenant via
    // the activation's payment).
    const topUsage = await db
        .select({
            username: radacct.username,
            sessions: count(radacct.radacctid),
            seconds: sql<number>`coalesce(sum(${radacct.acctsessiontime}), 0)::float8`,
            octets: sql<number>`coalesce(sum(coalesce(${radacct.acctinputoctets}, 0) + coalesce(${radacct.acctoutputoctets}, 0)), 0)::float8`,
        })
        .from(radacct)
        .innerJoin(
            activatedPackages,
            sql`${radacct.class} = ${activatedPackages.id}::text`,
        )
        .innerJoin(
            packagePayments,
            eq(activatedPackages.packagePaymentId, packagePayments.id),
        )
        .innerJoin(nasDevice, eq(packagePayments.nasDeviceId, nasDevice.id))
        .where(
            and(
                isNotNull(radacct.acctstarttime),
                gte(radacct.acctstarttime, from),
                lte(radacct.acctstarttime, to),
                scopedToAdminNas(adminId),
                scopedAccountingToAdminNas(adminId),
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
