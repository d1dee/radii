import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { nasDevice } from '../db/schema';

type InsertNasDevice = typeof nasDevice.$inferInsert;
export type NasDeviceRow = typeof nasDevice.$inferSelect;

export async function getNasDevices(ownerId: string) {
    return db
        .select()
        .from(nasDevice)
        .where(eq(nasDevice.ownerId, ownerId))
        .orderBy(desc(nasDevice.createdAt));
}

export async function getNasDeviceById(id: string, ownerId: string) {
    const [row] = await db
        .select()
        .from(nasDevice)
        .where(and(eq(nasDevice.ownerId, ownerId), eq(nasDevice.id, id)))
        .limit(1);
    return row;
}

export async function createNasDevice(data: InsertNasDevice) {
    const [row] = await db.insert(nasDevice).values(data).returning();
    return row;
}

export async function updateNasDevice(
    id: string,

    ownerId: string,
    data: Partial<InsertNasDevice>,
) {
    const [row] = await db
        .update(nasDevice)
        .set(data)
        .where(and(eq(nasDevice.ownerId, ownerId), eq(nasDevice.id, id)))
        .returning();
    return row;
}
