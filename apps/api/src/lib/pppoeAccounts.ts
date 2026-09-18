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
    nasDeviceId: string,
    phoneNumber: string,
    label?: string,
) {
    const normalizedPhone = zPhoneNumber.parse(phoneNumber);
    const [device] = await db
        .select({ id: nasDevice.id })
        .from(nasDevice)
        .where(
            and(
                eq(nasDevice.id, nasDeviceId),
                eq(nasDevice.ownerId, tenantAdminId),
            ),
        )
        .limit(1);
    if (!device) throw new Error('Unknown NAS device');
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
                nasDeviceId,
                normalizedPhone,
                username: generatedUsername(id),
                label: label?.trim() || null,
                claimCodeHash,
            })
            // No conflict target: re-provisioning a claimed phone can violate
            // both the (NAS, phone) and (customer, NAS) keys at once.
            .onConflictDoNothing();

        let [existing] = await tx
            .select()
            .from(pppoeServiceAccounts)
            .where(
                and(
                    eq(pppoeServiceAccounts.nasDeviceId, nasDeviceId),
                    eq(pppoeServiceAccounts.normalizedPhone, normalizedPhone),
                ),
            )
            .limit(1);
        if (!existing && customer) {
            [existing] = await tx
                .select()
                .from(pppoeServiceAccounts)
                .where(
                    and(
                        eq(pppoeServiceAccounts.nasDeviceId, nasDeviceId),
                        eq(pppoeServiceAccounts.customerUserId, customer.id),
                    ),
                )
                .limit(1);
        }
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
                nasDeviceId: existing.nasDeviceId ?? nasDeviceId,
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
    const [row] = await db
        .select({
            account: pppoeServiceAccounts,
            nas: { id: nasDevice.id, name: nasDevice.name },
        })
        .from(pppoeServiceAccounts)
        .leftJoin(nasDevice, eq(pppoeServiceAccounts.nasDeviceId, nasDevice.id))
        .where(
            and(
                eq(pppoeServiceAccounts.id, accountId),
                eq(pppoeServiceAccounts.tenantAdminId, tenantAdminId),
            ),
        )
        .limit(1);
    if (!row) return null;
    const { account, nas } = row;

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
        nasDeviceId: nas?.id ?? null,
        nasName: nas?.name ?? null,
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

// One dialer account per customer per NAS device: self-service purchases on
// the NAS-scoped portal key the account on (customer, NAS), so the same phone
// gets a distinct line on every network it subscribes to. A legacy account
// with no NAS yet is adopted (bonded to this NAS) instead of duplicating it.
export async function ensurePppoeServiceAccount(
    customerUserId: string,
    tenantAdminId: string,
    nasDeviceId: string,
) {
    const [customer] = await db
        .select({ username: user.username })
        .from(user)
        .where(eq(user.id, customerUserId))
        .limit(1);
    const normalizedPhone = zPhoneNumber.parse(customer?.username);

    const [existing] = await db
        .select()
        .from(pppoeServiceAccounts)
        .where(
            and(
                eq(pppoeServiceAccounts.customerUserId, customerUserId),
                eq(pppoeServiceAccounts.nasDeviceId, nasDeviceId),
            ),
        )
        .limit(1);
    if (existing) return existing;

    const [legacy] = await db
        .select()
        .from(pppoeServiceAccounts)
        .where(
            and(
                eq(pppoeServiceAccounts.customerUserId, customerUserId),
                eq(pppoeServiceAccounts.tenantAdminId, tenantAdminId),
                isNull(pppoeServiceAccounts.nasDeviceId),
            ),
        )
        .limit(1);
    if (legacy) {
        const [adopted] = await db
            .update(pppoeServiceAccounts)
            .set({ nasDeviceId })
            .where(
                and(
                    eq(pppoeServiceAccounts.id, legacy.id),
                    isNull(pppoeServiceAccounts.nasDeviceId),
                ),
            )
            .returning();
        if (adopted) return adopted;
    }

    // An admin-provisioned unclaimed account may already hold this
    // (NAS, phone) pair: the customer proved phone ownership by signing in,
    // so the first purchase on that network adopts (claims) it instead of
    // colliding with it.
    const [unclaimed] = await db
        .select()
        .from(pppoeServiceAccounts)
        .where(
            and(
                eq(pppoeServiceAccounts.nasDeviceId, nasDeviceId),
                eq(pppoeServiceAccounts.normalizedPhone, normalizedPhone),
                isNull(pppoeServiceAccounts.customerUserId),
            ),
        )
        .limit(1);
    if (unclaimed) {
        const [adopted] = await db
            .update(pppoeServiceAccounts)
            .set({ customerUserId, claimCodeHash: null })
            .where(
                and(
                    eq(pppoeServiceAccounts.id, unclaimed.id),
                    isNull(pppoeServiceAccounts.customerUserId),
                ),
            )
            .returning();
        if (adopted) return adopted;
    }

    const id = randomUUID();
    const [created] = await db
        .insert(pppoeServiceAccounts)
        .values({
            id,
            customerUserId,
            tenantAdminId,
            nasDeviceId,
            normalizedPhone,
            username: generatedUsername(id),
        })
        .onConflictDoNothing()
        .returning();
    if (created) return created;

    const [raced] = await db
        .select()
        .from(pppoeServiceAccounts)
        .where(
            and(
                eq(pppoeServiceAccounts.customerUserId, customerUserId),
                eq(pppoeServiceAccounts.nasDeviceId, nasDeviceId),
            ),
        )
        .limit(1);
    if (!raced) throw new Error('Could not create PPPoE service account');
    return raced;
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
            !account ||
            account.customerUserId !== payment.userId ||
            account.tenantAdminId !== payment.tenantAdminId
        )
            return null;
        // The payment's NAS is authoritative: bond an account that has none
        // yet, and refuse an account already bound to a different NAS so a
        // payment can never activate the line on the wrong router.
        if (account.nasDeviceId === null) {
            const [bonded] = await db
                .update(pppoeServiceAccounts)
                .set({ nasDeviceId: payment.nasDeviceId })
                .where(
                    and(
                        eq(pppoeServiceAccounts.id, account.id),
                        isNull(pppoeServiceAccounts.nasDeviceId),
                    ),
                )
                .returning();
            return bonded ?? account;
        }
        if (account.nasDeviceId !== payment.nasDeviceId) return null;
        return account;
    }
    if (!payment.tenantAdminId) return null;
    const account = await ensurePppoeServiceAccount(
        payment.userId,
        payment.tenantAdminId,
        payment.nasDeviceId,
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
            nas: { id: nasDevice.id, name: nasDevice.name },
        })
        .from(pppoeServiceAccounts)
        .innerJoin(adminUser, eq(pppoeServiceAccounts.tenantAdminId, adminUser.id))
        .leftJoin(nasDevice, eq(pppoeServiceAccounts.nasDeviceId, nasDevice.id))
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

// Resolves a RADIUS NAS-IP-Address (direct address or WireGuard tunnel
// address) to the single NAS device that owns it. NULL when the address is
// unknown or claimed by more than one device.
export async function resolveNasDeviceByIp(nasIpAddress: string) {
    const normalized = nasIpAddress.replace(/\/\d+$/, '');
    const rows = await db
        .select({
            id: nasDevice.id,
            ownerId: nasDevice.ownerId,
            name: nasDevice.name,
        })
        .from(nasDevice)
        .leftJoin(nasSetupScript, eq(nasSetupScript.nasDeviceId, nasDevice.id))
        .where(
            or(
                eq(nasDevice.ipAddress, normalized),
                eq(nasSetupScript.wgClientIp, normalized),
            ),
        );
    const unique = new Set(rows.map((row) => row.id));
    return unique.size === 1 ? rows[0]! : null;
}

// Bonds an account to the NAS it just appeared at (RADIUS authorize). Only
// fills a NULL nas_device_id; an already-bound account is never moved here —
// rebinding is an explicit admin migration.
export async function bondPppoeAccountToNas(
    accountId: string,
    nasDeviceId: string,
) {
    const [bonded] = await db
        .update(pppoeServiceAccounts)
        .set({ nasDeviceId, lastUsedAt: new Date() })
        .where(
            and(
                eq(pppoeServiceAccounts.id, accountId),
                isNull(pppoeServiceAccounts.nasDeviceId),
            ),
        )
        .returning();
    return bonded ?? null;
}

