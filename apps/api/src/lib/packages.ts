import type { Package } from '@radii/shared';
import {
    and,
    asc,
    count,
    desc,
    eq,
    exists,
    getTableColumns,
    inArray,
    sql,
} from 'drizzle-orm';
import { db } from '../db';
import {
    activatedPackages,
    packageNasDevice,
    packagePayments,
    packages,
    radacct,
    transaction,
} from '../db/schema';

type InsertPackage = typeof packages.$inferInsert;
export type PackageRow = typeof packages.$inferSelect;
export type PackageType = 'hotspot' | 'pppoe';

// Only packages explicitly linked to the given NAS device are returned; a
// package without any link rows never shows up.
export async function getPackagesGroupedByCategory(
    nasDeviceId: string,
): Promise<Array<[string, Package[]]>> {
    const rows = await db
        .select()
        .from(packages)
        .where(
            and(
                eq(packages.isActive, true),
                eq(packages.type, 'hotspot'),
                exists(
                    db
                        .select()
                        .from(packageNasDevice)
                        .where(
                            and(
                                eq(packageNasDevice.packageId, packages.id),
                                eq(packageNasDevice.nasDeviceId, nasDeviceId),
                            ),
                        ),
                ),
            ),
        )
        .orderBy(packages.category, asc(packages.title));

    const grouped = new Map<string, Package[]>();
    for (const row of rows) {
        const category = row.category;
        if (!grouped.has(category)) {
            grouped.set(category, []);
        }
        grouped.get(category)!.push({
            packageId: row.id,
            title: row.title,
            category: row.category,
            sessionLength: row.sessionLength,
            price: Number(row.price),
            maxDevices: row.maxDevices,
            noExpiry: row.noExpiry,
            description: row.description ?? undefined,
            note: row.note ?? undefined,
            uploadRate: row.uploadRate,
            downloadRate: row.downloadRate,
            downloadQuota: row.downloadQuota,
            uploadQuota: row.uploadQuota,
        });
    }
    return Array.from(grouped.entries());
}

// Admin listing: all packages of a given type (or both when omitted).
export async function getPackages(type?: PackageType) {
    const rows = await db
        .select()
        .from(packages)
        .where(type ? eq(packages.type, type) : undefined)
        .orderBy(packages.type, packages.category, asc(packages.title));
    return rows;
}

export async function getPackageById(id: string) {
    const [row] = await db
        .select()
        .from(packages)
        .where(eq(packages.id, id))
        .limit(1);
    return row;
}

// An empty nasDeviceIds list means the package is available on all NAS
// devices (no join rows are stored).
export async function createPackage(
    data: InsertPackage,
    nasDeviceIds: string[],
) {
    return db.transaction(async (tx) => {
        const [row] = await tx.insert(packages).values(data).returning();
        if (nasDeviceIds.length > 0) {
            await tx.insert(packageNasDevice).values(
                nasDeviceIds.map((nasDeviceId) => ({
                    packageId: row.id,
                    nasDeviceId,
                })),
            );
        }
        return row;
    });
}

export async function updatePackage(
    id: string,
    data: InsertPackage,
    nasDeviceIds: string[],
) {
    return db.transaction(async (tx) => {
        const [row] = await tx
            .update(packages)
            .set(data)
            .where(eq(packages.id, id))
            .returning();
        if (!row) return row;
        await tx
            .delete(packageNasDevice)
            .where(eq(packageNasDevice.packageId, id));
        if (nasDeviceIds.length > 0) {
            await tx.insert(packageNasDevice).values(
                nasDeviceIds.map((nasDeviceId) => ({
                    packageId: id,
                    nasDeviceId,
                })),
            );
        }
        return row;
    });
}

export async function getNasDeviceIdsForPackage(
    packageId: string,
): Promise<string[]> {
    const rows = await db
        .select({ nasDeviceId: packageNasDevice.nasDeviceId })
        .from(packageNasDevice)
        .where(eq(packageNasDevice.packageId, packageId));
    return rows.map((r) => r.nasDeviceId);
}

// Returns a map of package id -> linked NAS device ids for the given
// packages; packages absent from the map have no restriction.
export async function getNasDeviceIdsByPackage(
    packageIds: string[],
): Promise<Record<string, string[]>> {
    if (packageIds.length === 0) return {};
    const rows = await db
        .select({
            packageId: packageNasDevice.packageId,
            nasDeviceId: packageNasDevice.nasDeviceId,
        })
        .from(packageNasDevice)
        .where(inArray(packageNasDevice.packageId, packageIds));
    const map: Record<string, string[]> = {};
    for (const row of rows) {
        (map[row.packageId] ??= []).push(row.nasDeviceId);
    }
    return map;
}

export async function getPackageAnalytics(packageId: string) {
    const [paymentStats] = await db
        .select({
            total: count(packagePayments.id),
            pending: sql<number>`count(*) filter (where ${packagePayments.status} = 'pending')`,
            paid: sql<number>`count(*) filter (where ${packagePayments.status} = 'paid')`,
            failed: sql<number>`count(*) filter (where ${packagePayments.status} = 'failed')`,
            revenue: sql<number>`coalesce(sum(${packagePayments.amount}) filter (where ${packagePayments.status} = 'paid'), 0)::float8`,
            uniqueBuyers: sql<number>`count(distinct ${packagePayments.userId}) filter (where ${packagePayments.status} = 'paid')`,
        })
        .from(packagePayments)
        .where(eq(packagePayments.packageId, packageId));

    const repeatBuyers = db
        .select({ userId: packagePayments.userId })
        .from(packagePayments)
        .where(
            and(
                eq(packagePayments.packageId, packageId),
                eq(packagePayments.status, 'paid'),
            ),
        )
        .groupBy(packagePayments.userId)
        .having(sql`count(*) > 1`)
        .as('repeat_buyers');

    const [repeatStats] = await db
        .select({ repeat: count(repeatBuyers.userId) })
        .from(repeatBuyers);

    const [activationStats] = await db
        .select({
            total: count(activatedPackages.id),
            active: sql<number>`count(*) filter (where ${activatedPackages.expireAt} > now())`,
        })
        .from(activatedPackages)
        .where(eq(activatedPackages.packageId, packageId));

    const recentPayments = await db
        .select({
            id: packagePayments.id,
            phoneNumber: packagePayments.phoneNumber,
            amount: packagePayments.amount,
            status: packagePayments.status,
            createdAt: packagePayments.createdAt,
        })
        .from(packagePayments)
        .where(eq(packagePayments.packageId, packageId))
        .orderBy(desc(packagePayments.createdAt))
        .limit(10);

    return {
        payments: {
            total: Number(paymentStats.total),
            pending: Number(paymentStats.pending),
            paid: Number(paymentStats.paid),
            failed: Number(paymentStats.failed),
            revenue: Number(paymentStats.revenue),
        },
        buyers: {
            unique: Number(paymentStats.uniqueBuyers),
            repeat: Number(repeatStats.repeat),
        },
        activations: {
            total: Number(activationStats.total),
            active: Number(activationStats.active),
        },
        recentPayments,
    };
}

// Aggregated analytics for a single NAS device: payments, buyers and
// activations across all packages linked to the device, plus RADIUS session
// accounting matched by the device's IP address.
export async function getNasDeviceAnalytics(
    nasDeviceId: string,
    nasIpAddress: string,
) {
    const linkedPackageIds = () =>
        db
            .select({ packageId: packageNasDevice.packageId })
            .from(packageNasDevice)
            .where(eq(packageNasDevice.nasDeviceId, nasDeviceId));

    const [packageStats] = await db
        .select({
            total: count(packages.id),
            active: sql<number>`count(*) filter (where ${packages.isActive})`,
        })
        .from(packages)
        .where(
            exists(
                db
                    .select()
                    .from(packageNasDevice)
                    .where(
                        and(
                            eq(packageNasDevice.packageId, packages.id),
                            eq(packageNasDevice.nasDeviceId, nasDeviceId),
                        ),
                    ),
            ),
        );

    const [paymentStats] = await db
        .select({
            total: count(packagePayments.id),
            pending: sql<number>`count(*) filter (where ${packagePayments.status} = 'pending')`,
            paid: sql<number>`count(*) filter (where ${packagePayments.status} = 'paid')`,
            failed: sql<number>`count(*) filter (where ${packagePayments.status} = 'failed')`,
            revenue: sql<number>`coalesce(sum(${packagePayments.amount}) filter (where ${packagePayments.status} = 'paid'), 0)::float8`,
            uniqueBuyers: sql<number>`count(distinct ${packagePayments.userId}) filter (where ${packagePayments.status} = 'paid')`,
        })
        .from(packagePayments)
        .where(inArray(packagePayments.packageId, linkedPackageIds()));

    const repeatBuyers = db
        .select({ userId: packagePayments.userId })
        .from(packagePayments)
        .where(
            and(
                inArray(packagePayments.packageId, linkedPackageIds()),
                eq(packagePayments.status, 'paid'),
            ),
        )
        .groupBy(packagePayments.userId)
        .having(sql`count(*) > 1`)
        .as('repeat_buyers');

    const [repeatStats] = await db
        .select({ repeat: count(repeatBuyers.userId) })
        .from(repeatBuyers);

    const [activationStats] = await db
        .select({
            total: count(activatedPackages.id),
            active: sql<number>`count(*) filter (where ${activatedPackages.expireAt} > now())`,
        })
        .from(activatedPackages)
        .where(inArray(activatedPackages.packageId, linkedPackageIds()));

    const [sessionStats] = await db
        .select({
            total: count(radacct.radacctid),
            active: sql<number>`count(*) filter (where ${radacct.acctstoptime} is null)`,
        })
        .from(radacct)
        .where(eq(radacct.nasipaddress, nasIpAddress));

    const recentPayments = await db
        .select({
            id: packagePayments.id,
            phoneNumber: packagePayments.phoneNumber,
            amount: packagePayments.amount,
            status: packagePayments.status,
            packageTitle: packages.title,
            createdAt: packagePayments.createdAt,
        })
        .from(packagePayments)
        .innerJoin(packages, eq(packagePayments.packageId, packages.id))
        .where(inArray(packagePayments.packageId, linkedPackageIds()))
        .orderBy(desc(packagePayments.createdAt))
        .limit(10);

    return {
        packages: {
            total: Number(packageStats.total),
            active: Number(packageStats.active),
        },
        payments: {
            total: Number(paymentStats.total),
            pending: Number(paymentStats.pending),
            paid: Number(paymentStats.paid),
            failed: Number(paymentStats.failed),
            revenue: Number(paymentStats.revenue),
        },
        buyers: {
            unique: Number(paymentStats.uniqueBuyers),
            repeat: Number(repeatStats.repeat),
        },
        activations: {
            total: Number(activationStats.total),
            active: Number(activationStats.active),
        },
        sessions: {
            total: Number(sessionStats.total),
            active: Number(sessionStats.active),
        },
        recentPayments,
    };
}

export async function createPayment(data: {
    userId: string;
    packageId: string;
    amount: number;
    phoneNumber: string;
}) {
    const [row] = await db
        .insert(packagePayments)
        .values({
            userId: data.userId,
            packageId: data.packageId,
            amount: String(data.amount),
            phoneNumber: data.phoneNumber,
        })
        .returning();
    return row;
}

export async function getPaymentById(paymentId: string, userId: string) {
    const [payment] = await db
        .select()
        .from(packagePayments)
        .where(
            and(
                eq(packagePayments.id, paymentId),
                eq(packagePayments.userId, userId),
            ),
        )
        .limit(1);
    return payment;
}
export async function getPaymentByTransactionCode(transactionCode: string) {
    const [payment] = await db
        .select({
            ...getTableColumns(packagePayments),
        })
        .from(packagePayments)
        .innerJoin(transaction, eq(transaction.id, packagePayments.transaction))
        .where(eq(transaction.providerTransactionId, transactionCode));
    return payment;
}

export async function getUsersPaidPackages(userId: string) {
    const [payment] = await db
        .select()
        .from(packagePayments)
        .where(and(eq(packagePayments.userId, userId)))
        .orderBy(desc(packagePayments.createdAt));
    return payment;
}
