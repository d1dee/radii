import { and, desc, eq, or } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../db';
import {
    activatedPackages,
    adminUser,
    nasDevice,
    nasSetupScript,
    packagePayments,
    pppoeServiceAccounts,
} from '../db/schema';

function generatedUsername(id: string): string {
    return `PPP-${id.replace(/-/g, '').slice(0, 16).toUpperCase()}`;
}

export async function ensurePppoeServiceAccount(
    customerUserId: string,
    tenantAdminId: string,
) {
    const id = randomUUID();
    const [created] = await db
        .insert(pppoeServiceAccounts)
        .values({
            id,
            customerUserId,
            tenantAdminId,
            username: generatedUsername(id),
        })
        .onConflictDoNothing({
            target: [
                pppoeServiceAccounts.customerUserId,
                pppoeServiceAccounts.tenantAdminId,
            ],
        })
        .returning();
    if (created) return created;

    const [existing] = await db
        .select()
        .from(pppoeServiceAccounts)
        .where(
            and(
                eq(pppoeServiceAccounts.customerUserId, customerUserId),
                eq(pppoeServiceAccounts.tenantAdminId, tenantAdminId),
            ),
        )
        .limit(1);
    if (!existing) throw new Error('Could not create PPPoE service account');
    return existing;
}

export async function getPppoeAccountForPayment(
    payment: typeof packagePayments.$inferSelect,
) {
    if (payment.pppoeServiceAccountId) {
        const [account] = await db
            .select()
            .from(pppoeServiceAccounts)
            .where(eq(pppoeServiceAccounts.id, payment.pppoeServiceAccountId))
            .limit(1);
        if (
            account?.customerUserId === payment.userId &&
            account.tenantAdminId === payment.tenantAdminId
        )
            return account;
        return null;
    }
    if (!payment.tenantAdminId) return null;
    const account = await ensurePppoeServiceAccount(
        payment.userId,
        payment.tenantAdminId,
    );
    await db
        .update(packagePayments)
        .set({ pppoeServiceAccountId: account.id })
        .where(eq(packagePayments.id, payment.id));
    return account;
}

export async function getPppoeAccountForActivation(activationId: string) {
    const [row] = await db
        .select({ account: pppoeServiceAccounts })
        .from(activatedPackages)
        .innerJoin(
            pppoeServiceAccounts,
            eq(
                activatedPackages.pppoeServiceAccountId,
                pppoeServiceAccounts.id,
            ),
        )
        .where(eq(activatedPackages.id, activationId))
        .limit(1);
    return row?.account ?? null;
}

export async function getPppoeAccountOwnedByCustomer(
    accountId: string,
    customerUserId: string,
) {
    const [account] = await db
        .select()
        .from(pppoeServiceAccounts)
        .where(
            and(
                eq(pppoeServiceAccounts.id, accountId),
                eq(pppoeServiceAccounts.customerUserId, customerUserId),
            ),
        )
        .limit(1);
    return account ?? null;
}

export async function listPppoeServiceAccounts(
    customerUserId: string,
    tenantAdminId?: string | null,
) {
    return db
        .select({
            account: pppoeServiceAccounts,
            tenantName: adminUser.name,
        })
        .from(pppoeServiceAccounts)
        .innerJoin(adminUser, eq(pppoeServiceAccounts.tenantAdminId, adminUser.id))
        .where(
            and(
                eq(pppoeServiceAccounts.customerUserId, customerUserId),
                tenantAdminId
                    ? eq(pppoeServiceAccounts.tenantAdminId, tenantAdminId)
                    : undefined,
            ),
        )
        .orderBy(desc(pppoeServiceAccounts.lastUsedAt), pppoeServiceAccounts.createdAt);
}

export async function resolvePppoeServiceAccountByUsername(username: string) {
    const [account] = await db
        .select()
        .from(pppoeServiceAccounts)
        .where(eq(pppoeServiceAccounts.username, username.trim().toUpperCase()))
        .limit(1);
    return account ?? null;
}

export async function resolveUniqueNasTenant(nasIpAddress: string) {
    const normalized = nasIpAddress.replace(/\/\d+$/, '');
    const rows = await db
        .select({ ownerId: nasDevice.ownerId })
        .from(nasDevice)
        .leftJoin(nasSetupScript, eq(nasSetupScript.nasDeviceId, nasDevice.id))
        .where(
            or(
                eq(nasDevice.ipAddress, normalized),
                eq(nasSetupScript.wgClientIp, normalized),
            ),
        );
    const owners = new Set(rows.map((row) => row.ownerId));
    return owners.size === 1 ? [...owners][0]! : null;
}
