import { zPhoneNumber } from '@radii/shared';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { db } from '../db';
import {
    activatedPackages,
    adminUser,
    nasDevice,
    nasSetupScript,
    packagePayments,
    pppoeServiceAccounts,
    radcheck,
    user,
} from '../db/schema';

const CREDENTIAL_CHARS =
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const CLAIM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generatedUsername(id: string): string {
    return `PPP-${id.replace(/-/g, '').slice(0, 16).toUpperCase()}`;
}

function randomFromAlphabet(length: number, alphabet: string): string {
    const bytes = randomBytes(length);
    return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join(
        '',
    );
}

function hashClaimCode(code: string): string {
    return createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}

export async function provisionPppoeAccountByPhone(
    tenantAdminId: string,
    phoneNumber: string,
    label?: string,
) {
    const normalizedPhone = zPhoneNumber.parse(phoneNumber);
    const [customer] = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.username, normalizedPhone))
        .limit(1);
    const claimCode = customer
        ? null
        : randomFromAlphabet(8, CLAIM_CODE_CHARS);
    const claimCodeHash = claimCode ? hashClaimCode(claimCode) : null;
    const id = randomUUID();

    const account = await db.transaction(async (tx) => {
        await tx
            .insert(pppoeServiceAccounts)
            .values({
                id,
                customerUserId: customer?.id ?? null,
                tenantAdminId,
                normalizedPhone,
                username: generatedUsername(id),
                label: label?.trim() || null,
                claimCodeHash,
            })
            .onConflictDoNothing({
                target: [
                    pppoeServiceAccounts.tenantAdminId,
                    pppoeServiceAccounts.normalizedPhone,
                ],
            });

        const [existing] = await tx
            .select()
            .from(pppoeServiceAccounts)
            .where(
                and(
                    eq(pppoeServiceAccounts.tenantAdminId, tenantAdminId),
                    eq(pppoeServiceAccounts.normalizedPhone, normalizedPhone),
                ),
            )
            .limit(1);
        if (!existing) throw new Error('Could not provision PPPoE account');
        if (
            existing.customerUserId &&
            customer &&
            existing.customerUserId !== customer.id
        ) {
            throw new Error('PPPoE account is linked to another customer');
        }

        const linkedUserId = existing.customerUserId ?? customer?.id ?? null;
        const nextClaimCode = linkedUserId ? null : claimCode;
        const nextClaimCodeHash = linkedUserId ? null : claimCodeHash;
        const [updated] = await tx
            .update(pppoeServiceAccounts)
            .set({
                customerUserId: linkedUserId,
                claimCodeHash: nextClaimCodeHash,
                label: label?.trim() || existing.label,
            })
            .where(eq(pppoeServiceAccounts.id, existing.id))
            .returning();

        let [passwordRow] = await tx
            .select({ value: radcheck.value })
            .from(radcheck)
            .where(
                and(
                    eq(radcheck.username, existing.username),
                    eq(radcheck.attribute, 'Cleartext-Password'),
                ),
            )
            .limit(1);
        if (!passwordRow) {
            await tx
                .insert(radcheck)
                .values({
                    username: existing.username,
                    attribute: 'Cleartext-Password',
                    op: ':=',
                    value: randomFromAlphabet(12, CREDENTIAL_CHARS),
                })
                .onConflictDoNothing({
                    target: [radcheck.username, radcheck.attribute],
                });
            [passwordRow] = await tx
                .select({ value: radcheck.value })
                .from(radcheck)
                .where(
                    and(
                        eq(radcheck.username, existing.username),
                        eq(radcheck.attribute, 'Cleartext-Password'),
                    ),
                )
                .limit(1);
        }
        if (!updated || !passwordRow) {
            throw new Error('Could not provision PPPoE credentials');
        }
        return {
            account: updated,
            password: passwordRow.value,
            claimCode: nextClaimCode,
        };
    });

    return account;
}

// Admin-side detail view of one provisioned account, strictly scoped to the
// provisioning tenant. The dialer password lives in radcheck as cleartext
// (FreeRADIUS requirement), so it can be re-shown; the claim code is stored
// hashed only and must be regenerated by re-provisioning.
export async function getPppoeAccountAdminDetail(
    accountId: string,
    tenantAdminId: string,
) {
    const [account] = await db
        .select()
        .from(pppoeServiceAccounts)
        .where(
            and(
                eq(pppoeServiceAccounts.id, accountId),
                eq(pppoeServiceAccounts.tenantAdminId, tenantAdminId),
            ),
        )
        .limit(1);
    if (!account) return null;

    const [customer] = account.customerUserId
        ? await db
              .select({ id: user.id, name: user.name })
              .from(user)
              .where(eq(user.id, account.customerUserId))
              .limit(1)
        : [];
    const [passwordRow] = await db
        .select({ value: radcheck.value })
        .from(radcheck)
        .where(
            and(
                eq(radcheck.username, account.username),
                eq(radcheck.attribute, 'Cleartext-Password'),
            ),
        )
        .limit(1);

    return {
        id: account.id,
        phoneNumber: account.normalizedPhone,
        label: account.label,
        username: account.username,
        password: passwordRow?.value ?? null,
        status: account.status,
        awaitingClaim: account.customerUserId === null,
        claimCodePending: account.claimCodeHash !== null,
        customer: customer ?? null,
        lastUsedAt: account.lastUsedAt,
        createdAt: account.createdAt,
    };
}

export async function pendingPppoeClaimExists(
    phoneNumber: string,
    claimCode: string,
): Promise<boolean> {
    const normalizedPhone = zPhoneNumber.parse(phoneNumber);
    const rows = await db
        .select({ id: pppoeServiceAccounts.id })
        .from(pppoeServiceAccounts)
        .where(
            and(
                eq(pppoeServiceAccounts.normalizedPhone, normalizedPhone),
                eq(pppoeServiceAccounts.claimCodeHash, hashClaimCode(claimCode)),
                isNull(pppoeServiceAccounts.customerUserId),
            ),
        )
        .limit(1);
    return rows.length > 0;
}

export async function claimPppoeAccount(
    customerUserId: string,
    phoneNumber: string,
    claimCode: string,
) {
    const normalizedPhone = zPhoneNumber.parse(phoneNumber);
    const [account] = await db
        .update(pppoeServiceAccounts)
        .set({ customerUserId, claimCodeHash: null })
        .where(
            and(
                eq(pppoeServiceAccounts.normalizedPhone, normalizedPhone),
                eq(pppoeServiceAccounts.claimCodeHash, hashClaimCode(claimCode)),
                isNull(pppoeServiceAccounts.customerUserId),
            ),
        )
        .returning();
    return account ?? null;
}

export async function ensurePppoeServiceAccount(
    customerUserId: string,
    tenantAdminId: string,
) {
    const [customer] = await db
        .select({ username: user.username })
        .from(user)
        .where(eq(user.id, customerUserId))
        .limit(1);
    const normalizedPhone = zPhoneNumber.parse(customer?.username);
    const id = randomUUID();
    const [created] = await db
        .insert(pppoeServiceAccounts)
        .values({
            id,
            customerUserId,
            tenantAdminId,
            normalizedPhone,
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
