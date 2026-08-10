import type { Package } from '@radii/shared';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db';
import { packages, packagePayments } from '../db/schema';

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
