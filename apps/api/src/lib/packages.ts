import type { Package } from '@radii/shared';
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { activatedPackages, packages, packagePayments } from '../db/schema';

type InsertPackage = typeof packages.$inferInsert;
export type PackageRow = typeof packages.$inferSelect;
export type PackageType = 'hotspot' | 'pppoe';

export async function getPackagesGroupedByCategory(): Promise<
    Array<[string, Package[]]>
> {
    const rows = await db
        .select()
        .from(packages)
        .where(
            and(
                eq(packages.isActive, true),
                eq(packages.type, 'hotspot'),
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
            gateway: row.nasConfigId ?? undefined,
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
        .orderBy(
            packages.type,
            packages.category,
            asc(packages.title),
        );
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

export async function createPackage(data: InsertPackage) {
    const [row] = await db.insert(packages).values(data).returning();
    return row;
}

export async function updatePackage(id: string, data: InsertPackage) {
    const [row] = await db
        .update(packages)
        .set(data)
        .where(eq(packages.id, id))
        .returning();
    return row;
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

export async function createPayment(data: {
    id: string;
    userId: string;
    packageId: string;
    amount: number;
    phoneNumber: string;
}) {
    const [row] = await db
        .insert(packagePayments)
        .values({
            id: data.id,
            userId: data.userId,
            packageId: data.packageId,
            amount: String(data.amount),
            phoneNumber: data.phoneNumber,
        })
        .returning();
    return row;
}
