import { and, asc, count, desc, eq, ilike, or } from 'drizzle-orm';
import { db } from '../db';
import {
    hotspotLoginRequest,
    nas,
    nasDevice,
    nasSetupScript,
    packageNasDevice,
    packagePayments,
    pppoeServiceAccounts,
} from '../db/schema';

type InsertNasDevice = typeof nasDevice.$inferInsert;
export type NasDeviceRow = typeof nasDevice.$inferSelect;

export async function getNasDevices(ownerId: string) {
    return db
        .select()
        .from(nasDevice)
        .where(eq(nasDevice.ownerId, ownerId))
        .orderBy(desc(nasDevice.createdAt));
}

export async function listAdminNasDevices(opts: {
    ownerId: string;
    q?: string;
    status?: NasDeviceRow['status'];
    page: number;
    perPage: number;
}) {
    const conditions = [eq(nasDevice.ownerId, opts.ownerId)];
    if (opts.status) conditions.push(eq(nasDevice.status, opts.status));
    if (opts.q) {
        const q = `%${opts.q}%`;
        conditions.push(
            or(
                ilike(nasDevice.name, q),
                ilike(nasDevice.ipAddress, q),
                ilike(nasDevice.macAddress, q),
                ilike(nasDevice.model, q),
                ilike(nasDevice.serialNumber, q),
                ilike(nasDevice.location, q),
            )!,
        );
    }
    const where = and(...conditions);
    const [countRows, rows] = await Promise.all([
        db.select({ total: count(nasDevice.id) }).from(nasDevice).where(where),
        db
            .select()
            .from(nasDevice)
            .where(where)
            .orderBy(desc(nasDevice.createdAt), asc(nasDevice.id))
            .limit(opts.perPage)
            .offset((opts.page - 1) * opts.perPage),
    ]);
    return { total: Number(countRows[0]?.total ?? 0), rows };
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

export type DeleteNasDeviceResult =
    | { status: 'not_found' }
    | { status: 'in_use'; reason: 'packages' | 'customers' | 'pppoe' }
    | { status: 'deleted'; wgPublicKey: string | null };

export async function deleteNasDevice(
    id: string,
    ownerId: string,
): Promise<DeleteNasDeviceResult> {
    return db.transaction(async (tx) => {
        const [device] = await tx
            .select({ id: nasDevice.id })
            .from(nasDevice)
            .where(and(eq(nasDevice.ownerId, ownerId), eq(nasDevice.id, id)))
            .limit(1);
        if (!device) return { status: 'not_found' };

        const [packageLink, payment, login, pppoeAccount] = await Promise.all([
            tx
                .select({ id: packageNasDevice.packageId })
                .from(packageNasDevice)
                .where(eq(packageNasDevice.nasDeviceId, id))
                .limit(1),
            tx
                .select({ id: packagePayments.id })
                .from(packagePayments)
                .where(eq(packagePayments.nasDeviceId, id))
                .limit(1),
            tx
                .select({ id: hotspotLoginRequest.id })
                .from(hotspotLoginRequest)
                .where(eq(hotspotLoginRequest.nasDeviceId, id))
                .limit(1),
            tx
                .select({ id: pppoeServiceAccounts.id })
                .from(pppoeServiceAccounts)
                .where(eq(pppoeServiceAccounts.nasDeviceId, id))
                .limit(1),
        ]);

        if (pppoeAccount.length > 0) {
            return { status: 'in_use', reason: 'pppoe' };
        }
        if (payment.length > 0 || login.length > 0) {
            return { status: 'in_use', reason: 'customers' };
        }
        if (packageLink.length > 0) {
            return { status: 'in_use', reason: 'packages' };
        }

        const [setup] = await tx
            .select({
                wgClientIp: nasSetupScript.wgClientIp,
                wgPublicKey: nasSetupScript.wgPublicKey,
            })
            .from(nasSetupScript)
            .where(eq(nasSetupScript.nasDeviceId, id))
            .limit(1);
        if (setup) {
            await tx.delete(nas).where(eq(nas.nasname, setup.wgClientIp));
        }
        await tx
            .delete(nasDevice)
            .where(and(eq(nasDevice.ownerId, ownerId), eq(nasDevice.id, id)));

        return { status: 'deleted', wgPublicKey: setup?.wgPublicKey ?? null };
    });
}
