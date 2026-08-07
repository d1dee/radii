import type { Package } from '@radii/shared';
import { asc, eq } from 'drizzle-orm';
import { db } from '../db';
import { hotspotPackages, hotspotPayments } from '../db/schema';

type InsertHotspotPackage = typeof hotspotPackages.$inferInsert;

export async function getPackagesGroupedByCategory(): Promise<
    Array<[string, Package[]]>
> {
    const rows = await db
        .select()
        .from(hotspotPackages)
        .where(eq(hotspotPackages.isActive, true))
        .orderBy(hotspotPackages.category, asc(hotspotPackages.title));

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
            gateway: row.gatewayId ?? undefined,
        });
    }
    return Array.from(grouped.entries());
}

export async function getPackageById(id: string) {
    const [row] = await db
        .select()
        .from(hotspotPackages)
        .where(eq(hotspotPackages.id, id))
        .limit(1);
    return row;
}

export async function createPackage(data: InsertHotspotPackage) {
    const [row] = await db.insert(hotspotPackages).values(data).returning();
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
        .insert(hotspotPayments)
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
