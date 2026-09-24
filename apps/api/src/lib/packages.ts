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
    nasDevice,
    packageNasDevice,
    packagePayments,
    packages,
    radacct,
    transaction,
    transactionLog,
} from '../db/schema';

type InsertPackage = typeof packages.$inferInsert;
export type PackageRow = typeof packages.$inferSelect;
export type PackageType = 'hotspot' | 'pppoe';

// Only packages explicitly linked to the given NAS device are returned; a
// package without any link rows never shows up. Pass nasDeviceId=null to list
// packages of the type without a NAS restriction (the PPPoE portal has no
// captive-portal redirect that carries a device id).
export async function getPackagesGroupedByCategory(
    nasDeviceId: string | null,
    type: PackageType = 'hotspot',
): Promise<Array<[string, Package[]]>> {
    const rows = await db
        .select()
        .from(packages)
        .where(
            and(
                eq(packages.isActive, true),
                eq(packages.type, type),
                nasDeviceId
                    ? exists(
                          db
                              .select()
                              .from(packageNasDevice)
                              .where(
                                  and(
                                      eq(
                                          packageNasDevice.packageId,
                                          packages.id,
                                      ),
                                      eq(
                                          packageNasDevice.nasDeviceId,
                                          nasDeviceId,
                                      ),
                                  ),
                              ),
                      )
                    : undefined,
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
export async function getPackages(ownerId: string, type?: PackageType) {
    const rows = await db
        .select()
        .from(packages)
        .where(
            and(
                eq(packages.createdBy, ownerId),
                type ? eq(packages.type, type) : undefined,
            ),
        )
        .orderBy(packages.type, packages.category, asc(packages.title));
    return rows;
}

export async function getPackageById(id: string, ownerId?: string) {
    const [row] = await db
        .select()
        .from(packages)
        .where(
            and(
                eq(packages.id, id),
                ownerId ? eq(packages.createdBy, ownerId) : undefined,
            ),
        )
        .limit(1);
    return row;
}

// Public order authorization: the selected package and NAS must belong to the
// same tenant, and the package must be explicitly linked to that NAS.
export async function getOrderPackageForNas(
    packageId: string,
    nasDeviceId: string,
    type: PackageType,
) {
    const [row] = await db
        .select({ ...getTableColumns(packages) })
        .from(packages)
        .innerJoin(
            packageNasDevice,
            and(
                eq(packageNasDevice.packageId, packages.id),
                eq(packageNasDevice.nasDeviceId, nasDeviceId),
            ),
        )
        .innerJoin(nasDevice, eq(packageNasDevice.nasDeviceId, nasDevice.id))
        .where(
            and(
                eq(packages.id, packageId),
                eq(packages.type, type),
                eq(packages.isActive, true),
                eq(packages.createdBy, nasDevice.ownerId),
            ),
        )
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
    ownerId: string,
    data: InsertPackage,
    nasDeviceIds: string[],
) {
    return db.transaction(async (tx) => {
        const [row] = await tx
            .update(packages)
            .set(data)
            .where(and(eq(packages.id, id), eq(packages.createdBy, ownerId)))
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

export type DeletePackageResult = 'deleted' | 'not_found' | 'in_use';

export async function deletePackage(
    id: string,
    ownerId: string,
): Promise<DeletePackageResult> {
    return db.transaction(async (tx) => {
        const [pkg] = await tx
            .select({ id: packages.id })
            .from(packages)
            .where(and(eq(packages.id, id), eq(packages.createdBy, ownerId)))
            .limit(1);
        if (!pkg) return 'not_found';

        const [payment, activation] = await Promise.all([
            tx
                .select({ id: packagePayments.id })
                .from(packagePayments)
                .where(eq(packagePayments.packageId, id))
                .limit(1),
            tx
                .select({ id: activatedPackages.id })
                .from(activatedPackages)
                .where(eq(activatedPackages.packageId, id))
                .limit(1),
        ]);
        if (payment.length > 0 || activation.length > 0) return 'in_use';

        await tx
            .delete(packages)
            .where(and(eq(packages.id, id), eq(packages.createdBy, ownerId)));
        return 'deleted';
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

export async function getPackageAnalytics(packageId: string, ownerId: string) {
    const ownedPayments = and(
        eq(packagePayments.packageId, packageId),
        eq(nasDevice.ownerId, ownerId),
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
        .innerJoin(nasDevice, eq(packagePayments.nasDeviceId, nasDevice.id))
        .where(ownedPayments);

    const repeatBuyers = db
        .select({ userId: packagePayments.userId })
        .from(packagePayments)
        .innerJoin(nasDevice, eq(packagePayments.nasDeviceId, nasDevice.id))
        .where(
            and(
                ownedPayments,
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
            active: sql<number>`count(*) filter (where ${activatedPackages.expireAt} > now() and ${activatedPackages.deactivatedAt} is null)`,
        })
        .from(activatedPackages)
        .innerJoin(
            packagePayments,
            eq(activatedPackages.packagePaymentId, packagePayments.id),
        )
        .innerJoin(nasDevice, eq(packagePayments.nasDeviceId, nasDevice.id))
        .where(
            and(
                eq(activatedPackages.packageId, packageId),
                eq(nasDevice.ownerId, ownerId),
            ),
        );

    const recentPayments = await db
        .select({
            id: packagePayments.id,
            phoneNumber: packagePayments.phoneNumber,
            amount: packagePayments.amount,
            status: packagePayments.status,
            createdAt: packagePayments.createdAt,
        })
        .from(packagePayments)
        .innerJoin(nasDevice, eq(packagePayments.nasDeviceId, nasDevice.id))
        .where(ownedPayments)
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
    nasIpAddresses: string[],
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
        .where(eq(packagePayments.nasDeviceId, nasDeviceId));

    const repeatBuyers = db
        .select({ userId: packagePayments.userId })
        .from(packagePayments)
        .where(
            and(
                eq(packagePayments.nasDeviceId, nasDeviceId),
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
            active: sql<number>`count(*) filter (where ${activatedPackages.expireAt} > now() and ${activatedPackages.deactivatedAt} is null)`,
        })
        .from(activatedPackages)
        .innerJoin(
            packagePayments,
            eq(activatedPackages.packagePaymentId, packagePayments.id),
        )
        .where(eq(packagePayments.nasDeviceId, nasDeviceId));

    const [sessionStats] = await db
        .select({
            total: count(radacct.radacctid),
            active: sql<number>`count(*) filter (where ${radacct.acctstoptime} is null)`,
        })
        .from(radacct)
        .where(
            nasIpAddresses.length > 0
                ? inArray(radacct.nasipaddress, nasIpAddresses)
                : sql`false`,
        );

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
        .where(eq(packagePayments.nasDeviceId, nasDeviceId))
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

// Best-effort NAS attribution for a purchase when the portal could not
// identify the device: the package's NAS links resolve it. Package links can
// only be created/updated by the admin owning every linked device
// (ownsAllNasDevices in routes/admin.ts), so a link set with a single owner
// attributes the payment to that admin's network unambiguously. Returns null
// when unlinked or when links ever span multiple owners.
async function resolvePackageNasDevice(
    packageId: string,
): Promise<string | null> {
    const links = await db
        .select({
            nasDeviceId: packageNasDevice.nasDeviceId,
            ownerId: nasDevice.ownerId,
        })
        .from(packageNasDevice)
        .innerJoin(nasDevice, eq(packageNasDevice.nasDeviceId, nasDevice.id))
        .where(eq(packageNasDevice.packageId, packageId));
    if (links.length === 0) return null;
    const owners = new Set(links.map((l) => l.ownerId));
    if (owners.size !== 1) return null;
    return links[0].nasDeviceId;
}

export async function createPayment(data: {
    userId: string;
    pkg: PackageRow;
    phoneNumber: string;
    loginRequestId?: string | null;
    // The NAS device the purchase happened through; tenant attribution for
    // admin-scoped views. Falls back to the package's NAS links when omitted.
    nasDeviceId?: string | null;
    tenantAdminId?: string | null;
    pppoeServiceAccountId?: string | null;
}) {
    const nasDeviceId =
        data.nasDeviceId ?? (await resolvePackageNasDevice(data.pkg.id));
    let tenantAdminId = data.tenantAdminId ?? null;
    if (!tenantAdminId && nasDeviceId) {
        const [device] = await db
            .select({ ownerId: nasDevice.ownerId })
            .from(nasDevice)
            .where(eq(nasDevice.id, nasDeviceId))
            .limit(1);
        tenantAdminId = device?.ownerId ?? null;
    }
    const amount = Number(data.pkg.price);
    const values = {
        userId: data.userId,
        packageId: data.pkg.id,
        amount: String(amount),
        phoneNumber: data.phoneNumber,
        nasDeviceId,
        tenantAdminId,
        pppoeServiceAccountId: data.pppoeServiceAccountId ?? null,
    };

    if (amount !== 0) {
        const [row] = await db
            .insert(packagePayments)
            .values(values)
            .returning();
        return row;
    }

    // Free purchases are settled entirely inside the database. The completed
    // internal transaction keeps the same audit/metadata shape that RADIUS
    // activation consumes, without resolving or invoking a payment provider.
    return db.transaction(async (tx) => {
        const [payment] = await tx
            .insert(packagePayments)
            .values(values)
            .returning();
        const internalReference = `free:${payment.id}`;
        const [internalTransaction] = await tx
            .insert(transaction)
            .values({
                userId: data.userId,
                type: 'income',
                amount: '0',
                provider: 'internal',
                status: 'completed',
                providerTransactionId: internalReference,
                providerReference: internalReference,
                description: `Free package purchase: ${data.pkg.title}`,
                metadata: {
                    packagePaymentId: payment.id,
                    packageId: data.pkg.id,
                    settlement: 'free_package',
                    ...(data.loginRequestId
                        ? { loginRequestId: data.loginRequestId }
                        : {}),
                },
            })
            .returning();
        const [paidPayment] = await tx
            .update(packagePayments)
            .set({ status: 'paid', transaction: internalTransaction.id })
            .where(
                and(
                    eq(packagePayments.id, payment.id),
                    eq(packagePayments.status, 'pending'),
                ),
            )
            .returning();
        if (!paidPayment) {
            throw new Error('Failed to settle free package payment');
        }
        await tx.insert(transactionLog).values({
            transactionId: internalTransaction.id,
            provider: 'internal',
            eventType: 'payment_completed_free_package',
            payload: {
                message: 'Free package order completed internally.',
                packagePaymentId: payment.id,
            },
        });
        return paidPayment;
    });
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
