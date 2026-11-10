import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import {
    activatedPackages,
    activationEvents,
    nasDevice,
    packageNasDevice,
    packagePayments,
    packages,
    pppoeServiceAccounts,
    transaction,
    transactionLog,
    user,
} from '../db/schema';
import { radiusClient } from './radius';
import { recordConfirmedCollection } from './payments/collections';

export type AdminActivationPaymentMethod =
    | 'cash'
    | 'mpesa'
    | 'cheque'
    | 'free';

export async function createAdminActivation(input: {
    adminId: string;
    userId: string;
    packageId: string;
    nasDeviceId: string;
    pppoeServiceAccountId?: string;
    paymentMethod: AdminActivationPaymentMethod;
    paymentReference?: string;
    amount: number;
    note?: string;
    expireAt?: Date;
    remainingSeconds?: number;
}) {
    const [customer] = await db
        .select({ id: user.id, phoneNumber: user.username })
        .from(user)
        .where(eq(user.id, input.userId))
        .limit(1);
    if (!customer) return { error: 'User not found' } as const;

    const [eligiblePackage] = await db
        .select({ pkg: packages, nasDeviceId: packageNasDevice.nasDeviceId })
        .from(packages)
        .innerJoin(
            packageNasDevice,
            and(
                eq(packageNasDevice.packageId, packages.id),
                eq(packageNasDevice.nasDeviceId, input.nasDeviceId),
            ),
        )
        .innerJoin(
            nasDevice,
            and(
                eq(nasDevice.id, packageNasDevice.nasDeviceId),
                eq(nasDevice.ownerId, input.adminId),
            ),
        )
        .where(
            and(
                eq(packages.id, input.packageId),
                eq(packages.createdBy, input.adminId),
            ),
        )
        .limit(1);
    if (!eligiblePackage) {
        return { error: 'Package is not available on the selected NAS device' } as const;
    }

    let pppoeServiceAccountId: string | null = null;
    if (eligiblePackage.pkg.type === 'pppoe') {
        if (!input.pppoeServiceAccountId) {
            return { error: 'Select a PPPoE account for this activation' } as const;
        }
        const [account] = await db
            .select({ id: pppoeServiceAccounts.id })
            .from(pppoeServiceAccounts)
            .where(
                and(
                    eq(pppoeServiceAccounts.id, input.pppoeServiceAccountId),
                    eq(pppoeServiceAccounts.customerUserId, input.userId),
                    eq(pppoeServiceAccounts.tenantAdminId, input.adminId),
                    eq(pppoeServiceAccounts.nasDeviceId, input.nasDeviceId),
                    eq(pppoeServiceAccounts.status, 'active'),
                ),
            )
            .limit(1);
        if (!account) {
            return { error: 'Select an active PPPoE account on this NAS device' } as const;
        }
        pppoeServiceAccountId = account.id;
    }

    const isFree = input.paymentMethod === 'free';
    const paymentReference = input.paymentReference?.trim() || null;
    if (!isFree && !paymentReference) {
        return { error: 'Enter the payment reference' } as const;
    }

    const payment = await db.transaction(async (tx) => {
        const [createdPayment] = await tx
            .insert(packagePayments)
            .values({
                userId: input.userId,
                packageId: input.packageId,
                nasDeviceId: input.nasDeviceId,
                tenantAdminId: input.adminId,
                pppoeServiceAccountId,
                status: 'paid',
                amount: String(isFree ? 0 : input.amount),
                phoneNumber: customer.phoneNumber ?? '',
            })
            .returning();
        const reference = paymentReference ?? `grant:${createdPayment!.id}`;
        const provider = isFree
            ? 'admin-free'
            : `admin-${input.paymentMethod}`;
        const [createdTransaction] = await tx
            .insert(transaction)
            .values({
                userId: input.userId,
                type: 'income',
                amount: String(isFree ? 0 : input.amount),
                provider,
                status: 'completed',
                providerTransactionId: reference,
                providerReference: reference,
                description: isFree
                    ? `Free package granted by administrator: ${eligiblePackage.pkg.title}`
                    : `Manual ${input.paymentMethod} package activation: ${eligiblePackage.pkg.title}`,
                metadata: {
                    settlement: 'admin_activation',
                    administeredBy: input.adminId,
                    paymentMethod: input.paymentMethod,
                    paymentReference: reference,
                    free: isFree,
                    note: input.note?.trim() || null,
                    customLimits:
                        input.expireAt && input.remainingSeconds !== undefined
                            ? {
                                  expireAt: input.expireAt.toISOString(),
                                  remainingSeconds: input.remainingSeconds,
                              }
                            : null,
                },
            })
            .returning();
        await tx
            .update(packagePayments)
            .set({ transaction: createdTransaction!.id })
            .where(eq(packagePayments.id, createdPayment!.id));
        if (!isFree) {
            await recordConfirmedCollection(tx, createdTransaction!.id, 'admin_activation', input.paymentMethod);
        }
        await tx.insert(transactionLog).values({
            transactionId: createdTransaction!.id,
            provider,
            eventType: isFree
                ? 'admin_free_package_granted'
                : 'admin_manual_payment_recorded',
            payload: {
                packagePaymentId: createdPayment!.id,
                packageId: input.packageId,
                administeredBy: input.adminId,
                paymentMethod: input.paymentMethod,
                reference,
                note: input.note?.trim() || null,
            },
        });
        return createdPayment!;
    });

    const provisioned = await radiusClient.ensureProvisioned(payment.id);
    if (!provisioned) {
        return {
            error: 'Payment was recorded, but the package could not be provisioned',
            paymentId: payment.id,
        } as const;
    }

    if (input.expireAt && input.remainingSeconds !== undefined) {
        const result = await radiusClient.setActivationLimits(
            provisioned.activationId,
            input.expireAt,
            input.remainingSeconds,
            { adminId: input.adminId, actorId: input.adminId },
        );
        if (!result.ok) {
            return {
                error: 'Package was provisioned, but custom limits could not be applied',
                paymentId: payment.id,
                activationId: provisioned.activationId,
            } as const;
        }
    }

    const [activation] = await db
        .select({ expireAt: activatedPackages.expireAt })
        .from(activatedPackages)
        .where(eq(activatedPackages.id, provisioned.activationId))
        .limit(1);
    await db
        .update(activationEvents)
        .set({
            actorType: 'admin',
            actorId: input.adminId,
            source: 'admin_api',
            metadata: {
                paymentId: payment.id,
                packageId: input.packageId,
                packageType: eligiblePackage.pkg.type,
                expireAt: activation?.expireAt.toISOString() ?? null,
                paymentMethod: input.paymentMethod,
                paymentReference:
                    paymentReference ?? `grant:${payment.id}`,
                free: isFree,
                note: input.note?.trim() || null,
            },
        })
        .where(
            and(
                eq(activationEvents.activationId, provisioned.activationId),
                eq(activationEvents.eventType, 'created'),
            ),
        );

    return {
        paymentId: payment.id,
        activationId: provisioned.activationId,
        expireAt: activation?.expireAt ?? null,
        free: isFree,
    } as const;
}
