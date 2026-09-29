import {
    and,
    asc,
    count,
    desc,
    eq,
    getTableColumns,
    ilike,
    or,
    sql,
    type SQL,
} from 'drizzle-orm';
import { db } from '../db';
import {
    hotspotLoginRequest,
    nas,
    nasDevice,
    nasSetupScript,
    packageNasDevice,
    packagePayments,
    pppoeServiceAccounts,
    radacct,
} from '../db/schema';

type InsertNasDevice = typeof nasDevice.$inferInsert;
export type NasDeviceRow = typeof nasDevice.$inferSelect;
export type AdminNasDeviceSortBy =
    | 'name'
    | 'ipAddress'
    | 'model'
    | 'serialNumber'
    | 'firmwareVersion'
    | 'location'
    | 'online'
    | 'lastSeen'
    | 'status';

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
    online?: boolean;
    sortBy?: AdminNasDeviceSortBy;
    sortDirection?: 'asc' | 'desc';
    page: number;
    perPage: number;
}) {
    const online = sql<boolean>`exists (
        select 1
        from ${radacct} accounting
        where (
            accounting.nasipaddress = ${nasDevice.ipAddress}
            or accounting.nasipaddress = ${nasSetupScript.wgClientIp}
        )
        and accounting.acctstarttime is not null
        and accounting.acctstoptime is null
    )`;
    const conditions: SQL[] = [eq(nasDevice.ownerId, opts.ownerId)];
    if (opts.status) conditions.push(eq(nasDevice.status, opts.status));
    if (opts.online !== undefined) {
        conditions.push(opts.online ? online : sql`not (${online})`);
    }
    if (opts.q) {
        const q = `%${opts.q}%`;
        conditions.push(
            or(
                ilike(nasDevice.name, q),
                ilike(sql`${nasDevice.ipAddress}::text`, q),
                ilike(nasDevice.macAddress, q),
                ilike(nasDevice.model, q),
                ilike(nasDevice.serialNumber, q),
                ilike(nasDevice.location, q),
            )!,
        );
    }
    const where = and(...conditions);
    const lastSeen = sql<Date | null>`(
        select max(coalesce(accounting.acctupdatetime, accounting.acctstarttime))
        from ${radacct} accounting
        where accounting.nasipaddress = ${nasDevice.ipAddress}
            or accounting.nasipaddress = ${nasSetupScript.wgClientIp}
    )`;
    const direction = opts.sortDirection === 'asc' ? asc : desc;
    const nullableOrder = (value: Parameters<typeof asc>[0]) => [
        sql<number>`case when ${value} is null then 1 else 0 end`,
        direction(value),
        asc(nasDevice.id),
    ];
    const orderBy = (() => {
        switch (opts.sortBy) {
            case 'name':
                return [direction(nasDevice.name), asc(nasDevice.id)];
            case 'ipAddress':
                return [direction(nasDevice.ipAddress), asc(nasDevice.id)];
            case 'model':
                return nullableOrder(nasDevice.model);
            case 'serialNumber':
                return nullableOrder(nasDevice.serialNumber);
            case 'firmwareVersion':
                return nullableOrder(nasDevice.firmwareVersion);
            case 'location':
                return nullableOrder(nasDevice.location);
            case 'online':
                return [direction(online), asc(nasDevice.id)];
            case 'lastSeen':
                return nullableOrder(lastSeen);
            case 'status':
                return [direction(nasDevice.status), asc(nasDevice.id)];
            default:
                return [desc(nasDevice.createdAt), asc(nasDevice.id)];
        }
    })();
    const [countRows, rows] = await Promise.all([
        db
            .select({
                total: count(nasDevice.id),
                onlineTotal: sql<number>`count(*) filter (where ${online})::int`,
            })
            .from(nasDevice)
            .leftJoin(
                nasSetupScript,
                eq(nasSetupScript.nasDeviceId, nasDevice.id),
            )
            .where(where),
        db
            .select({
                ...getTableColumns(nasDevice),
                online,
                lastSeen,
                wgClientIp: nasSetupScript.wgClientIp,
                wgPublicKey: nasSetupScript.wgPublicKey,
            })
            .from(nasDevice)
            .leftJoin(
                nasSetupScript,
                eq(nasSetupScript.nasDeviceId, nasDevice.id),
            )
            .where(where)
            .orderBy(...orderBy)
            .limit(opts.perPage)
            .offset((opts.page - 1) * opts.perPage),
    ]);
    return {
        total: Number(countRows[0]?.total ?? 0),
        onlineTotal: Number(countRows[0]?.onlineTotal ?? 0),
        rows,
    };
}

export async function getNasDeviceById(id: string, ownerId: string) {
    const [row] = await db
        .select({
            ...getTableColumns(nasDevice),
            wgClientIp: nasSetupScript.wgClientIp,
            wgPublicKey: nasSetupScript.wgPublicKey,
        })
        .from(nasDevice)
        .leftJoin(nasSetupScript, eq(nasSetupScript.nasDeviceId, nasDevice.id))
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
