// Core payment flow: provider registry plus the provider-agnostic
// orchestration and persistence around it. Everything in this file works with
// any PaymentProvider; gateway specifics never leak in here. New gateways are
// added by implementing PaymentProvider and calling register() — routes and
// this service require zero changes.
//
// Persistence mapping (schema is the source of truth):
//  - transaction       one row per payment attempt, keyed by provider +
//                      providerReference (gateway lookup key) and later
//                      providerTransactionId (gateway receipt/transaction id)
//  - transaction_log   append-only record of every provider event (initiation
//                      ack, webhooks, verification queries/results)
//  - package_payments  the user-facing payment; linked to its transaction and
//                      flipped pending -> paid/failed when the provider
//                      resolves it

import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { PaymentClaimActivationDetails, PaymentClaimOutcome } from '@radii/shared';
import { db } from '../../db';
import {
    packagePayments,
    activatedPackages,
    pppoeServiceAccounts,
    user,
    nasDevice,
    packages,
    transaction,
    transactionLog,
} from '../../db/schema';
import { env } from '../../env';
import { apiLogger } from '../../logging';
import { getAdminIdForNasDevice, getAdminIdForUser } from '../adminSettings';
import { type PackageRow } from '../packages';
import { radiusClient, type ActivationRedirect } from '../radius';
import {
    getAdminMpesaProvider,
    parseAdminIdFromProviderName,
    resolveProviderByName,
} from './adminProviders';
import { newCallbackNonce } from './callbackToken';
import { paymentLogError, paymentLogInfo, paymentLogWarn } from './log';
import {
    MPESA_CALLBACK_EVENTS,
    MPESA_PROVIDER_NAME,
    normalizeMpesaPhoneNumber,
} from './mpesa/provider';
import {
    PaymentProviderError,
    paymentFailureMessage,
    type ClientPaymentFailure,
    type PaymentOutcome,
    type PaymentProvider,
    type ProviderCallbackResult,
} from './types';

const logger = apiLogger.getChild('payments');

export type PackagePaymentRow = typeof packagePayments.$inferSelect;
type TransactionRow = typeof transaction.$inferSelect;

export interface CallbackRouteResponse {
    status: 200 | 400 | 404;
    body: { success: boolean; message?: string };
}

// Outcome of verifying a gateway transaction code. `error` marks failures the
// route should surface as an API error (bad config / gateway rejection)
// rather than a pollable "pending". Returning null from the service means
// "report 404 to the caller" (unknown receipt, or owned by someone else).
export interface VerifyByCodeOutcome {
    status: 'pending' | 'paid' | 'failed';
    paymentId: string | null;
    message: string;
    error?: boolean;
    errorStatus?: 409 | 502;
    // Present once the verified payment has its package activated on RADIUS;
    // the portal uses it for the final redirect to the NAS.
    activation?: ActivationRedirect | null;
    claimOutcome?: PaymentClaimOutcome;
    activationDetails?: PaymentClaimActivationDetails | null;
}

export interface ReceiptClaimScope {
    nasDeviceId: string;
    serviceAccountId?: string;
    loginRequestId?: string;
}

const STATUS_QUERY_EVENT = 'status_query';
const STATUS_CALLBACK_EVENT = 'status_callback';
const STATUS_POLL_EVENT = 'status_poll';
// Disable automatic STK polling only; explicit receipt verification stays enabled.
const AUTOMATIC_STATUS_POLLING_ENABLED = false;
const STATUS_CALLBACK_WAIT_MS = 30_000;
const STATUS_POLL_INTERVAL_MS = 15_000;
const PAYMENT_UNAVAILABLE_MESSAGE =
    'Payments are temporarily unavailable. Please try again in a moment.';
const PAYMENT_START_FAILED_MESSAGE =
    'We could not start the payment. Please try again in a moment.';
const PAYMENT_VERIFICATION_FAILED_MESSAGE =
    'We could not verify that receipt right now. Please try again in a moment.';

export class PaymentService {
    private providers = new Map<string, PaymentProvider>();
    private defaultProviderName: string | null = null;
    private reconciliationInFlight = new Map<string, Promise<void>>();
    private reportsInFlight = new Map<string, Promise<void>>();
    private statusPollsInFlight = new Map<string, Promise<PackagePaymentRow['status']>>();

    // Register a provider. The first registered provider becomes the default
    // for package purchases. Throws on duplicate names so misconfiguration
    // fails loudly at startup instead of shadowing an earlier provider.
    register(provider: PaymentProvider): void {
        if (this.providers.has(provider.name)) {
            throw new PaymentProviderError(
                `A payment provider named "${provider.name}" is already registered.`,
                provider.name,
            );
        }
        this.providers.set(provider.name, provider);
        this.defaultProviderName ??= provider.name;
    }

    getProvider(name: string): PaymentProvider | undefined {
        return this.providers.get(name);
    }

    get providerNames(): string[] {
        return [...this.providers.keys()];
    }

    private get defaultProvider(): PaymentProvider | null {
        return this.defaultProviderName
            ? (this.providers.get(this.defaultProviderName) ?? null)
            : null;
    }

    // Resolves a provider by its stored name, covering both server-registered
    // providers and per-admin M-Pesa providers ("mpesa-<adminId>") rebuilt
    // from that admin's own credentials.
    private async resolveProvider(
        name: string,
    ): Promise<PaymentProvider | null> {
        return resolveProviderByName(name, (n) => this.providers.get(n));
    }

    // Picks the provider for a customer flow: the tenant admin's own M-Pesa
    // credentials when they configured any, otherwise the server-wide
    // default. Throws PaymentProviderError when the admin enabled their own
    // credentials but stored an unusable configuration (never silently fall
    // back to the global shortcode in that case).
    private async providerForAdmin(
        adminId: string | null,
    ): Promise<PaymentProvider | null> {
        const adminProvider = await getAdminMpesaProvider(adminId);
        return adminProvider ?? this.defaultProvider;
    }

    callbackBaseUrl(providerName: string): string {
        return `${env.apiUrl}/api/payments/callback/${providerName}`;
    }

    // Provider names a receipt/verification lookup should span: the resolved
    // provider plus the global M-Pesa names, since a customer's earlier
    // transactions may predate (or postdate) the admin switching to their own
    // credentials. M-Pesa receipt codes are gateway-unique, so widening the
    // provider filter cannot mis-attribute a receipt.
    private providerFamilyNames(primary: string): string[] {
        const names = new Set([primary]);
        if (
            primary === MPESA_PROVIDER_NAME ||
            parseAdminIdFromProviderName(primary)
        ) {
            names.add(MPESA_PROVIDER_NAME);
            if (this.defaultProviderName) names.add(this.defaultProviderName);
        }
        return [...names];
    }

    // --- Package purchase flow ------------------------------------------------

    // Initiates a payment for a package purchase that already has its
    // package_payments row. Returns a user-facing error message on failure;
    // the payment row stays pending so the customer can retry. The initiating
    // login request id (when the purchase happened through a hotspot portal)
    // is carried in the transaction metadata; activation uses it to find the
    // NAS servlet links for the final redirect back to MikroTik.
    async initiatePackagePayment(
        payment: PackagePaymentRow,
        pkg: PackageRow,
        loginRequestId?: string | null,
    ): Promise<{ success: boolean; message: string }> {
        const amount = Number(pkg.price);
        if (!Number.isSafeInteger(amount) || amount < 1) {
            paymentLogError('invalid_package_amount', {
                paymentId: payment.id,
                packageId: pkg.id,
                amount: pkg.price,
            });
            await db
                .update(packagePayments)
                .set({ status: 'failed' })
                .where(eq(packagePayments.id, payment.id));
            return {
                success: false,
                message:
                    'This package cannot be purchased right now. Please contact support.',
            };
        }

        // Tenant attribution: payment -> NAS device -> owning admin. When the
        // owner stored their own M-Pesa credentials the payment runs through
        // their till; otherwise the server-wide provider is used.
        let provider: PaymentProvider | null;
        try {
            const adminId = await getAdminIdForNasDevice(payment.nasDeviceId);
            provider = await this.providerForAdmin(adminId);
        } catch (err) {
            if (err instanceof PaymentProviderError) {
                paymentLogError(
                    'provider_configuration_failed',
                    {
                        paymentId: payment.id,
                        userId: payment.userId,
                        nasDeviceId: payment.nasDeviceId,
                        provider: err.provider,
                    },
                    err,
                );
                await db
                    .update(packagePayments)
                    .set({ status: 'failed' })
                    .where(eq(packagePayments.id, payment.id));
                return { success: false, message: PAYMENT_UNAVAILABLE_MESSAGE };
            }
            throw err;
        }
        if (!provider) {
            paymentLogWarn('provider_unavailable', {
                paymentId: payment.id,
                userId: payment.userId,
                nasDeviceId: payment.nasDeviceId,
            });
            await db
                .update(packagePayments)
                .set({ status: 'failed' })
                .where(eq(packagePayments.id, payment.id));
            return {
                success: false,
                message: PAYMENT_UNAVAILABLE_MESSAGE,
            };
        }

        // Nonce for the STK callback URL handed to the gateway; stored on the
        // transaction row and embedded (HMAC-signed) in the URL so only
        // deliveries to a server-issued callback URL pass route auth.
        const stkCallbackNonce = newCallbackNonce();
        const txRow = await db.transaction(async (trx) => {
            const [row] = await trx
                .insert(transaction)
                .values({
                    userId: payment.userId,
                    type: 'income',
                    amount: String(amount),
                    provider: provider.name,
                    status: 'pending',
                    description: `Package purchase: ${pkg.title}`,
                    callbackNonces: {
                        [MPESA_CALLBACK_EVENTS.stk]: stkCallbackNonce,
                    },
                    metadata: {
                        packagePaymentId: payment.id,
                        packageId: pkg.id,
                        ...(loginRequestId ? { loginRequestId } : {}),
                    },
                })
                .returning();
            await trx
                .update(packagePayments)
                .set({ transaction: row.id })
                .where(eq(packagePayments.id, payment.id));
            return row;
        });

        paymentLogInfo('initiation_requested', {
            paymentId: payment.id,
            transactionId: txRow.id,
            userId: payment.userId,
            provider: provider.name,
            amount,
            currency: 'KES',
        });

        let result;
        try {
            result = await provider.initiatePayment({
                amount,
                currency: 'KES',
                phoneNumber: payment.phoneNumber,
                accountReference: payment.id.replace(/-/g, '').slice(0, 12),
                description: pkg.title,
                callbackBaseUrl: this.callbackBaseUrl(provider.name),
                callbackNonce: stkCallbackNonce,
            });
        } catch (err) {
            paymentLogError(
                'initiation_threw',
                {
                    paymentId: payment.id,
                    transactionId: txRow.id,
                    userId: payment.userId,
                    provider: provider.name,
                },
                err,
            );
            await this.applyOutcome(txRow, 'failed', {
                source: 'initiation_exception',
                message:
                    err instanceof Error ? err.message : 'Unknown provider error',
            });
            return { success: false, message: PAYMENT_START_FAILED_MESSAGE };
        }

        if (result.outcome !== 'pending' || !result.reference) {
            paymentLogError('initiation_rejected', {
                paymentId: payment.id,
                transactionId: txRow.id,
                userId: payment.userId,
                provider: provider.name,
                providerRequestId: result.requestId,
                providerMessage: result.message,
            });
            await this.applyOutcome(txRow, 'failed', {
                source: 'initiation',
                message: result.message,
                clientFailure: result.clientFailure,
                requestId: result.requestId,
            });
            return {
                success: false,
                message: result.clientFailure
                    ? paymentFailureMessage(result.clientFailure)
                    : PAYMENT_START_FAILED_MESSAGE,
            };
        }

        await db
            .update(transaction)
            .set({ providerReference: result.reference })
            .where(eq(transaction.id, txRow.id));
        await this.appendLog(
            txRow.id,
            provider.name,
            'payment_initiated',
            {
                reference: result.reference,
                message: result.message,
            },
            result.requestId,
        );

        paymentLogInfo('initiation_accepted', {
            paymentId: payment.id,
            transactionId: txRow.id,
            userId: payment.userId,
            provider: provider.name,
            providerReference: result.reference,
            providerRequestId: result.requestId,
        });

        return {
            success: true,
            message: 'Check your phone to complete the payment.',
        };
    }

    // Returns the current status, opportunistically reconciling a pending
    // payment with the provider (poll by reference). Called on every client
    // poll so payments converge even when webhooks do not arrive (e.g. dev
    // machines without a public URL).
    async refreshPackagePaymentStatus(
        payment: PackagePaymentRow,
    ): Promise<'pending' | 'paid' | 'failed'> {
        if (!AUTOMATIC_STATUS_POLLING_ENABLED) {
            return this.getPackagePaymentStatus(payment.id, payment.status);
        }
        if (payment.status === 'failed' || !payment.transaction) {
            return payment.status;
        }

        const txRow = await this.getTransaction(payment.transaction);
        if (!txRow) return payment.status;
        const localStatus = await this.getPackagePaymentStatus(payment.id, payment.status);
        if (localStatus === 'failed') return localStatus;
        const provider = await this.resolveProvider(txRow.provider);
        if (!provider) return localStatus;
        if (txRow.status === 'completed') {
            return localStatus;
        }
        if (txRow.status !== 'pending' || !txRow.providerReference) return localStatus;

        if (this.statusPollsInFlight.has(txRow.id)) return localStatus;
        const work = this.pollPackagePaymentStatus(payment, txRow, provider, localStatus);
        this.statusPollsInFlight.set(txRow.id, work);
        try { return await work; }
        finally { this.statusPollsInFlight.delete(txRow.id); }
    }

    private async pollPackagePaymentStatus(
        payment: PackagePaymentRow, txRow: TransactionRow, provider: PaymentProvider,
        localStatus: PackagePaymentRow['status'],
    ): Promise<PackagePaymentRow['status']> {

        // Give callbacks time to arrive before the first fallback query, then
        // throttle subsequent queries. Portal polls still read local status.
        if (provider.handleCallback && !await this.claimStatusPoll(txRow.id)) {
            return this.getPackagePaymentStatus(payment.id, localStatus);
        }

        let result;
        try {
            result = await provider.getPaymentStatus(txRow.providerReference);
        } catch (err) {
            paymentLogError(
                'status_poll_threw',
                {
                    paymentId: payment.id,
                    transactionId: txRow.id,
                    provider: txRow.provider,
                    providerReference: txRow.providerReference,
                },
                err,
            );
            await this.appendLog(txRow.id, txRow.provider, STATUS_POLL_EVENT, {
                phase: 'error', message: PAYMENT_UNAVAILABLE_MESSAGE,
            });
            return this.getPackagePaymentStatus(payment.id, localStatus);
        }
        paymentLogInfo('status_polled', {
            paymentId: payment.id,
            transactionId: txRow.id,
            provider: txRow.provider,
            providerReference: txRow.providerReference,
            outcome: result.outcome,
            providerTransactionId: result.transactionId,
            providerMessage: result.message,
        });
        await this.appendLog(txRow.id, txRow.provider, STATUS_POLL_EVENT, {
            phase: 'result', outcome: result.outcome, message: result.message,
        });
        if (result.outcome === 'completed') {
            const receipt = result.transactionId ?? await this.receiptFromStkCallback(txRow, provider, payment);
            const transitioned = await this.applyOutcome(txRow, 'completed', {
                transactionId: receipt,
                source: 'status_poll',
                message: result.message,
            });
            const status = transitioned
                ? 'paid'
                : await this.getPackagePaymentStatus(payment.id, payment.status);
            if (status === 'paid') {
                // Reporting is enrichment only; never wait for it before
                // authorizing the portal's already-confirmed payment.
                void this.requestPaymentReport(txRow, provider).catch((error) =>
                    paymentLogError('payment_report_threw', {
                        transactionId: txRow.id, provider: txRow.provider,
                    }, error),
                );
            }
            return status;
        }
        if (result.outcome === 'failed') {
            const transitioned = await this.applyOutcome(txRow, 'failed', {
                source: 'status_poll',
                message: result.message,
                clientFailure: result.clientFailure,
            });
            return transitioned
                ? 'failed'
                : await this.getPackagePaymentStatus(payment.id, payment.status);
        }
        return this.getPackagePaymentStatus(payment.id, payment.status);
    }

    // Only use callback metadata after the checkout has been independently
    // confirmed. Daraja's STK receipt is not its MerchantRequestID.
    private async receiptFromStkCallback(
        tx: TransactionRow, provider: PaymentProvider, payment: PackagePaymentRow,
    ): Promise<string | null> {
        if (!provider.handleCallback) return null;
        const [entry] = await db.select({ payload: transactionLog.payload }).from(transactionLog)
            .where(and(eq(transactionLog.transactionId, tx.id), eq(transactionLog.eventType, 'stk_callback_received')))
            .orderBy(desc(transactionLog.createdAt)).limit(1);
        if (!entry) return null;
        const callback = await provider.handleCallback(MPESA_CALLBACK_EVENTS.stk, entry.payload);
        if (callback.outcome !== 'completed' || callback.reference !== tx.providerReference ||
            callback.amount !== Number(tx.amount) || !callback.payerPhoneNumber ||
            callback.payerPhoneNumber !== normalizeMpesaPhoneNumber(payment.phoneNumber) ||
            !callback.transactionId || !/^[A-Z0-9]{6,15}$/i.test(callback.transactionId)) return null;
        return callback.transactionId.toUpperCase();
    }

    private async claimStatusPoll(transactionId: string): Promise<boolean> {
        return db.transaction(async (trx) => {
            const [tx] = await trx.select().from(transaction)
                .where(eq(transaction.id, transactionId)).for('update');
            if (!tx || tx.status !== 'pending') return false;
            if (Date.now() - tx.createdAt.getTime() < STATUS_CALLBACK_WAIT_MS) return false;
            const [last] = await trx.select({ createdAt: transactionLog.createdAt }).from(transactionLog)
                .where(and(eq(transactionLog.transactionId, tx.id), eq(transactionLog.eventType, STATUS_POLL_EVENT),
                    sql`${transactionLog.payload}->>'phase' = 'requested'`))
                .orderBy(desc(transactionLog.createdAt)).limit(1);
            if (last && Date.now() - last.createdAt.getTime() < STATUS_POLL_INTERVAL_MS) return false;
            await trx.insert(transactionLog).values({ transactionId: tx.id, provider: tx.provider,
                eventType: STATUS_POLL_EVENT, payload: { phase: 'requested' } });
            return true;
        });
    }

    async canQueryTransactionStatus(transactionId: string): Promise<boolean> {
        const tx = await this.getTransaction(transactionId);
        if (!tx || tx.status !== 'completed' || tx.providerTransactionId) return false;
        const [prior] = await db.select({ id: transactionLog.id })
            .from(transactionLog).where(and(
                eq(transactionLog.transactionId, tx.id),
                eq(transactionLog.eventType, STATUS_QUERY_EVENT),
                sql`${transactionLog.payload}->>'purpose' = 'admin_reconcile'`,
            )).limit(1);
        if (prior) return false;
        try {
            const provider = await this.resolveProvider(tx.provider);
            if (!provider?.requestPaymentReport) return false;
            const [payment] = await db.select().from(packagePayments)
                .where(eq(packagePayments.transaction, tx.id)).limit(1);
            return Boolean(payment && await this.receiptFromStkCallback(tx, provider, payment));
        } catch {
            return false;
        }
    }

    // At most one admin query per payment, including failed attempts. Scope
    // and eligibility are checked again, not trusted from the detail response.
    async reconcileAdminPayment(paymentId: string, adminId: string): Promise<boolean> {
        const key = `${adminId}:${paymentId}`;
        const existing = this.reconciliationInFlight.get(key);
        if (existing) {
            await existing;
            return true;
        }
        let visible = false;
        const work = (async () => {
            const [row] = await db.select({ payment: packagePayments, tx: transaction })
                .from(packagePayments)
                .innerJoin(nasDevice, eq(nasDevice.id, packagePayments.nasDeviceId))
                .leftJoin(transaction, eq(transaction.id, packagePayments.transaction))
                .where(and(eq(packagePayments.id, paymentId), eq(nasDevice.ownerId, adminId)))
                .limit(1);
            if (!row) return;
            visible = true;
            const tx = row.tx;
            if (row.payment.status !== 'paid' || !tx || !await this.canQueryTransactionStatus(tx.id)) return;
            const provider = await this.resolveProvider(tx.provider);
            if (!provider?.requestPaymentReport) return;
            await this.requestPaymentReport(tx, provider, { paymentId, adminId });
        })();
        this.reconciliationInFlight.set(key, work);
        try { await work; return visible; }
        finally { this.reconciliationInFlight.delete(key); }
    }

    private async requestPaymentReport(
        txRow: TransactionRow,
        provider: PaymentProvider,
        adminScope?: { paymentId: string; adminId: string },
    ): Promise<void> {
        if (!provider.requestPaymentReport) return;
        const current = await this.getTransaction(txRow.id);
        if (!current || current.status !== 'completed') return;
        const [payment] = await db.select().from(packagePayments)
            .where(eq(packagePayments.transaction, current.id)).limit(1);
        const receipt = current.providerTransactionId ?? (payment
            ? await this.receiptFromStkCallback(current, provider, payment) : null);
        // No receipt means no valid Transaction Status lookup for an STK
        // purchase. Never substitute MerchantRequestID or sweep old payments.
        if (!receipt) return;
        const purpose = adminScope ? 'admin_reconcile' : 'payment_report';
        const existing = this.reportsInFlight.get(txRow.id);
        if (existing) {
            await existing;
            if (!adminScope) return;
        }
        const work = (async () => {
            const claim = await db.transaction(async (trx) => {
                const [tx] = await trx.select().from(transaction)
                    .where(eq(transaction.id, txRow.id)).for('update');
                if (!tx || tx.status !== 'completed') return null;
                if (adminScope) {
                    if (tx.providerTransactionId) return null;
                    const [payment] = await trx.select({ id: packagePayments.id })
                        .from(packagePayments).innerJoin(nasDevice, eq(nasDevice.id, packagePayments.nasDeviceId))
                        .where(and(eq(packagePayments.id, adminScope.paymentId),
                            eq(packagePayments.transaction, tx.id), eq(packagePayments.status, 'paid'),
                            eq(nasDevice.ownerId, adminScope.adminId))).limit(1);
                    if (!payment) return null;
                }
                const [prior] = await trx.select({ id: transactionLog.id }).from(transactionLog)
                    .where(and(eq(transactionLog.transactionId, tx.id), eq(transactionLog.eventType, STATUS_QUERY_EVENT),
                        sql`${transactionLog.payload}->>'purpose' = ${purpose}`)).limit(1);
                if (prior) return null;
                const [initiated] = await trx.select({ requestId: transactionLog.providerRequestId }).from(transactionLog)
                    .where(and(eq(transactionLog.transactionId, tx.id), eq(transactionLog.eventType, 'payment_initiated')))
                    .orderBy(desc(transactionLog.createdAt)).limit(1);
                // Reports authenticate against their durable attempt, not the
                // shared status nonce used by an in-flight manual receipt claim.
                const nonce = newCallbackNonce();
                await trx.insert(transactionLog).values({ transactionId: tx.id, provider: tx.provider,
                    eventType: STATUS_QUERY_EVENT, payload: { purpose, phase: 'requested', nonce },
                    providerRequestId: initiated?.requestId ?? null });
                return { tx, nonce, receipt: tx.providerTransactionId ?? receipt, requestId: initiated?.requestId ?? null };
            });
            if (!claim) return;
            try {
                const result = await provider.requestPaymentReport!({
                    transactionId: claim.receipt, requestId: claim.requestId,
                }, { callbackBaseUrl: this.callbackBaseUrl(provider.name), callbackNonce: claim.nonce });
                await this.appendLog(txRow.id, provider.name, STATUS_QUERY_EVENT, {
                    ...result.data, purpose, phase: 'result', nonce: claim.nonce, outcome: result.outcome, message: result.message,
                }, claim.requestId, result.conversationId);
                if (result.outcome === 'completed') {
                    const rejection = await this.amountMismatch(claim.tx, result.amount ?? null)
                        ?? await this.payerMismatchForTransaction(claim.tx, result.payerPhoneNumber ?? null, { source: 'payment_report' });
                    if (!rejection) await this.applyOutcome(claim.tx, 'completed', {
                        source: 'payment_report', enrichmentOnly: true, message: result.message,
                        transactionId: result.transactionId, amount: result.amount,
                        conversationId: result.conversationId,
                    });
                }
            } catch (error) {
                paymentLogError('payment_report_threw', { transactionId: txRow.id, provider: provider.name }, error);
                await this.appendLog(txRow.id, provider.name, STATUS_QUERY_EVENT, {
                    purpose, phase: 'error', message: PAYMENT_UNAVAILABLE_MESSAGE,
                });
            }
        })();
        this.reportsInFlight.set(txRow.id, work);
        try { await work; }
        finally { this.reportsInFlight.delete(txRow.id); }
    }

    // Resolve immutable receipt ownership/history first. Unknown receipts
    // require exactly one scoped purchase and a durable bounded verification.
    async verifyTransactionCode(
        userId: string,
        rawCode: string,
        tenantAdminId?: string,
        packageType?: 'hotspot' | 'pppoe',
        scope?: ReceiptClaimScope,
        pollOnly = false,
    ): Promise<VerifyByCodeOutcome | null> {
        const code = rawCode.trim().toUpperCase();

        if (!tenantAdminId || !packageType || !scope?.nasDeviceId) return null;
        if (packageType === 'pppoe') {
            if (!scope.serviceAccountId) return null;
            const [account] = await db.select({ id: pppoeServiceAccounts.id }).from(pppoeServiceAccounts)
                .where(and(eq(pppoeServiceAccounts.id, scope.serviceAccountId),
                    eq(pppoeServiceAccounts.customerUserId, userId),
                    eq(pppoeServiceAccounts.tenantAdminId, tenantAdminId),
                    eq(pppoeServiceAccounts.nasDeviceId, scope.nasDeviceId))).limit(1);
            if (!account) return null;
        }
        const conditions = [
            eq(packagePayments.userId, userId),
            eq(packagePayments.tenantAdminId, tenantAdminId),
            eq(packagePayments.nasDeviceId, scope.nasDeviceId),
            eq(packages.type, packageType),
        ];
        if (scope.serviceAccountId) conditions.push(
            eq(packagePayments.pppoeServiceAccountId, scope.serviceAccountId),
        );
        // Completed receipts are globally owned, independent of the current
        // provider configuration. Never disclose an out-of-scope purchase.
        const [owner] = await db.select({ tx: transaction, payment: packagePayments, pkg: packages })
            .from(transaction)
            .leftJoin(packagePayments, eq(packagePayments.transaction, transaction.id))
            .leftJoin(packages, eq(packages.id, packagePayments.packageId))
            .where(and(eq(transaction.providerTransactionId, code), eq(transaction.status, 'completed')))
            .limit(1);
        if (owner) {
            const payment = owner.payment;
            if (!payment || payment.userId !== userId || payment.tenantAdminId !== tenantAdminId ||
                payment.nasDeviceId !== scope.nasDeviceId || owner.pkg?.type !== packageType ||
                (scope.serviceAccountId && payment.pppoeServiceAccountId !== scope.serviceAccountId)) return null;
            return this.receiptClaimForPayment(payment, packageType, scope);
        }

        if (pollOnly) {
            const [attempt] = await db.select({ log: transactionLog, tx: transaction, payment: packagePayments })
                .from(transactionLog)
                .innerJoin(transaction, eq(transaction.id, transactionLog.transactionId))
                .innerJoin(packagePayments, eq(packagePayments.transaction, transaction.id))
                .innerJoin(packages, eq(packages.id, packagePayments.packageId))
                .where(and(...conditions, eq(transactionLog.eventType, STATUS_QUERY_EVENT),
                    sql`${transactionLog.payload}->>'purpose' = 'receipt_claim'`,
                    sql`${transactionLog.payload}->>'receipt' = ${code}`,
                    sql`${transactionLog.payload}->>'userId' = ${userId}`,
                    sql`${transactionLog.payload}->>'tenantAdminId' = ${tenantAdminId}`,
                    sql`${transactionLog.payload}->>'nasDeviceId' = ${scope.nasDeviceId}`,
                    sql`${transactionLog.payload}->>'packageType' = ${packageType}`,
                    scope.serviceAccountId ? sql`${transactionLog.payload}->>'serviceAccountId' = ${scope.serviceAccountId}` : undefined,
                )).orderBy(desc(transactionLog.createdAt)).limit(1);
            if (!attempt) return null;
            const requested = attempt.log.payload as { phase?: string; nonce?: string };
            if (requested.phase === 'rejected' || requested.phase === 'error') return {
                status: 'pending', paymentId: attempt.payment.id, error: true, errorStatus: 409,
                message: requested.phase === 'error' ? PAYMENT_VERIFICATION_FAILED_MESSAGE
                    : 'The receipt could not be verified for this purchase. Check the code or contact support.',
            };
            if (requested.phase === 'expired' || Date.now() - attempt.log.createdAt.getTime() > 120_000) return {
                status: 'pending', paymentId: attempt.payment.id, error: true, errorStatus: 409,
                message: 'The verification callback did not arrive in time. Check again to submit a new verification request.',
            };
            if ((attempt.tx.callbackNonces as Record<string, string> | null)?.[MPESA_CALLBACK_EVENTS.status] !== requested.nonce) return {
                status: 'pending', paymentId: attempt.payment.id, error: true, errorStatus: 409,
                message: 'A newer verification request replaced this one. Check the receipt again.',
            };
            return { status: 'pending', paymentId: attempt.payment.id, message: 'Waiting for the provider to confirm this transaction...' };
        }

        // Attribute the verification to the tenant admin the customer last
        // paid (their M-Pesa till issued the receipt); fall back to the
        // server-wide provider when no attribution exists.
        let provider: PaymentProvider | null;
        try {
            const adminId =
                tenantAdminId ?? (await getAdminIdForUser(userId));
            provider = await this.providerForAdmin(adminId);
        } catch (err) {
            if (err instanceof PaymentProviderError) {
                paymentLogError(
                    'verification_provider_configuration_failed',
                    { userId, tenantAdminId, provider: err.provider },
                    err,
                );
                return {
                    status: 'pending',
                    paymentId: null,
                    message: PAYMENT_VERIFICATION_FAILED_MESSAGE,
                    error: true,
                };
            }
            throw err;
        }
        if (!provider) {
            paymentLogWarn('verification_provider_unavailable', {
                userId,
                tenantAdminId,
            });
            return {
                status: 'pending',
                paymentId: null,
                message: PAYMENT_UNAVAILABLE_MESSAGE,
                error: true,
            };
        }

        const family = this.providerFamilyNames(provider.name);
        const pendingConditions = [
            ...conditions,
            // Failed purchases can be recovered only by a verified receipt;
            // paid purchases without a receipt need ownership enrichment.
            or(isNull(transaction.providerTransactionId), eq(transaction.providerTransactionId, code))!,
            inArray(transaction.provider, family),
        ];
        if (tenantAdminId) {
            pendingConditions.push(
                eq(packagePayments.tenantAdminId, tenantAdminId),
            );
        }
        if (packageType) {
            pendingConditions.push(eq(packages.type, packageType));
        }
        const targets = await db
            .select({ payment: packagePayments, tx: transaction, customerPhone: user.username })
            .from(packagePayments)
            .innerJoin(user, eq(user.id, packagePayments.userId))
            .innerJoin(packages, eq(packages.id, packagePayments.packageId))
            .innerJoin(
                transaction,
                eq(transaction.id, packagePayments.transaction),
            )
            .where(and(...pendingConditions))
            .orderBy(desc(packagePayments.createdAt))
            .limit(2);
        if (targets.length > 1) {
            paymentLogWarn('verification_ambiguous_pending_payment', {
                userId,
                tenantAdminId,
                packageType,
                pendingPaymentIds: targets.map(({ payment }) => payment.id),
            });
            return {
                status: 'pending',
                paymentId: null,
                message:
                    'More than one payment is still pending. Wait for the latest payment to finish or contact support before verifying a receipt.',
                error: true,
                errorStatus: 409,
            };
        }
        const target = targets[0];
        if (!target) {
            paymentLogWarn('verification_without_pending_payment', {
                userId,
                tenantAdminId,
                packageType,
                provider: provider.name,
                receipt: code,
            });
            return {
                status: 'pending',
                paymentId: null,
                message:
                    'No pending payment was found. Start a package purchase before verifying a receipt.',
                error: true,
                errorStatus: 409,
            };
        }
        const customerPhone = normalizeMpesaPhoneNumber(target.customerPhone ?? '');
        if (!customerPhone || customerPhone !== normalizeMpesaPhoneNumber(target.payment.phoneNumber)) return {
            status: 'pending', paymentId: null, error: true, errorStatus: 409,
            message: 'This receipt cannot be matched safely to your account. Contact support.',
        };
        // Callback URLs must use the exact provider stored on this purchase,
        // including legacy global-provider purchases in a tenant scope.
        provider = await this.resolveProvider(target.tx.provider);
        if (!provider) return {
            status: 'pending', paymentId: target.payment.id, message: PAYMENT_UNAVAILABLE_MESSAGE, error: true,
        };

        // Persist the exact target, requested receipt and signed nonce before
        // dispatch, under a row lock shared by concurrent claims.
        const attempt = await db.transaction(async (trx) => {
            const [current] = await trx.select().from(transaction)
                .where(eq(transaction.id, target.tx.id)).for('update');
            if (!current || (current.providerTransactionId && current.providerTransactionId !== code)) return null;
            const attempts = await trx.select().from(transactionLog).where(and(
                eq(transactionLog.transactionId, target.tx.id),
                eq(transactionLog.eventType, STATUS_QUERY_EVENT),
                sql`${transactionLog.payload}->>'purpose' = 'receipt_claim'`,
            )).orderBy(desc(transactionLog.createdAt));
            const latest = attempts[0];
            // Dedupe the entire target, not just one receipt. A typo must not
            // retire a valid query already in flight.
            if (latest && Date.now() - latest.createdAt.getTime() < 120_000) return {
                pending: true, phase: (latest.payload as { phase?: string }).phase,
            };
            if (attempts.filter((entry) => (entry.payload as { receipt?: string })?.receipt === code).length >= 3) return { exhausted: true };
            const nonces = (current?.callbackNonces ?? {}) as Record<string, string>;
            const nonce = newCallbackNonce();
            await trx.update(transaction).set({
                callbackNonces: { ...nonces, [MPESA_CALLBACK_EVENTS.status]: nonce },
            }).where(eq(transaction.id, target.tx.id));
            const [claim] = await trx.insert(transactionLog).values({
                transactionId: target.tx.id, provider: current.provider, eventType: STATUS_QUERY_EVENT,
                payload: { purpose: 'receipt_claim', phase: 'requested', nonce, receipt: code,
                    userId, tenantAdminId, packageType, nasDeviceId: scope.nasDeviceId,
                    serviceAccountId: scope.serviceAccountId ?? null, customerPhone },
            }).returning({ id: transactionLog.id });
            return { nonce, id: claim!.id };
        });
        if (!attempt) return null;
        if ('pending' in attempt && (attempt.phase === 'rejected' || attempt.phase === 'error' || attempt.phase === 'expired')) return {
            status: 'pending', paymentId: target.payment.id, error: true, errorStatus: 409,
            message: 'The receipt could not be verified for this purchase. Check the code or contact support.',
        };
        if (!('nonce' in attempt)) return {
            status: 'pending', paymentId: target.payment.id,
            message: 'exhausted' in attempt
                ? 'Receipt verification could not finish. Contact support before trying again.'
                : 'Verification is still in progress. Check back in a moment.',
            ...('exhausted' in attempt ? { error: true, errorStatus: 409 as const } : {}),
        };
        const statusCallbackNonce = attempt.nonce;

        let result;
        try {
            result = await provider.verifyTransaction(code, {
                callbackBaseUrl: this.callbackBaseUrl(provider.name),
                callbackNonce: statusCallbackNonce,
            });
        } catch (err) {
            await trxAttemptPhase('error');
            paymentLogError(
                'verification_threw',
                { userId, tenantAdminId, provider: provider.name, receipt: code },
                err,
            );
            return {
                status: 'pending',
                paymentId: null,
                message: PAYMENT_VERIFICATION_FAILED_MESSAGE,
                error: true,
            };
        }

        if (result.outcome === 'failed') {
            await trxAttemptPhase('rejected');
            paymentLogError('verification_rejected', {
                userId,
                tenantAdminId,
                provider: provider.name,
                receipt: code,
                providerMessage: result.message,
            });
            return {
                status: 'pending',
                paymentId: null,
                message: result.clientFailure
                    ? paymentFailureMessage(result.clientFailure)
                    : PAYMENT_VERIFICATION_FAILED_MESSAGE,
                error: true,
            };
        }

        if (result.outcome === 'completed') {
            // Same completion guards as the async status-callback path: the
            // receipt must be for the package amount and paid by the phone
            // number on the payment.
            const rejection =
                (result.amount == null || !normalizeMpesaPhoneNumber(result.payerPhoneNumber ?? '') ||
                    normalizeMpesaPhoneNumber(result.payerPhoneNumber ?? '') !== customerPhone
                    ? 'The provider could not establish ownership of this receipt.' : null) ??
                (await this.amountMismatch(
                    target.tx,
                    result.amount ?? null,
                )) ??
                this.payerMismatch(
                    target.payment.phoneNumber,
                    result.payerPhoneNumber ?? null,
                    {
                        transactionId: target.tx.id,
                        paymentId: target.payment.id,
                        provider: provider.name,
                        source: 'receipt_verification',
                        receipt: code,
                    },
                );
            if (rejection) {
                await trxAttemptPhase('rejected');
                return {
                    paymentId: target.payment.id,
                    status: 'pending', error: true, errorStatus: 409,
                    message: rejection,
                };
            }
            const transitioned = await this.applyOutcome(
                target.tx,
                'completed',
                {
                    transactionId: code,
                    source: 'receipt_verification',
                    message: result.message,
                    verifiedReceipt: true,
                    verificationNonce: statusCallbackNonce,
                },
            );
            const verifiedTransaction = await this.getTransaction(target.tx.id);
            if (verifiedTransaction?.providerTransactionId !== code || verifiedTransaction.status !== 'completed') return null;
            const status = transitioned
                ? 'paid'
                : await this.getPackagePaymentStatus(
                      target.payment.id,
                      target.payment.status,
                  );
            if (status === 'paid') return this.receiptClaimForPayment({ ...target.payment, status }, packageType, scope);
            return {
                paymentId: target.payment.id,
                status,
                message: 'The receipt was verified, but the payment state changed. Refresh and try again.',
            };
        }

        if (result.conversationId) {
            await db.update(transactionLog).set({ providerConversationId: result.conversationId })
                .where(eq(transactionLog.id, attempt.id));
        }

        return {
            paymentId: target.payment.id,
            status: 'pending',
            message: 'Waiting for the provider to confirm this transaction...',
        };

        async function trxAttemptPhase(phase: string) {
            await db.update(transactionLog).set({ payload: sql`${transactionLog.payload} || ${JSON.stringify({ phase })}::jsonb` })
                .where(eq(transactionLog.id, attempt!.id!));
        }
    }

    // Dispatches an inbound webhook to the owning provider and reconciles the
    // referenced transaction. Returns the HTTP response for the gateway.
    // callbackNonce is the nonce from the route-verified signed ?ct= token
    // (see ./callbackToken.ts). STK and receipt claims bind to the transaction;
    // report callbacks bind to their durable query attempt.
    async handleProviderCallback(
        providerName: string,
        event: string,
        payload: unknown,
        callbackNonce?: string | null,
    ): Promise<CallbackRouteResponse> {
        let provider = await this.resolveProvider(providerName);
        if (!provider && parseAdminIdFromProviderName(providerName)) {
            // The admin's own credentials are no longer resolvable (settings
            // cleared/disabled). Callback payload parsing is credential-
            // agnostic, so the global M-Pesa provider can still normalize it
            // and the referenced transaction is reconciled by its stored row.
            provider = this.providers.get(MPESA_PROVIDER_NAME) ?? null;
        }
        if (!provider) {
            return {
                status: 404,
                body: {
                    success: false,
                    message: `Unknown payment provider "${providerName}".`,
                },
            };
        }
        if (!provider.handleCallback) {
            return {
                status: 404,
                body: {
                    success: false,
                    message: `Payment provider "${providerName}" does not accept callbacks.`,
                },
            };
        }

        let result: ProviderCallbackResult;
        try {
            result = await provider.handleCallback(event, payload);
        } catch (err) {
            if (err instanceof PaymentProviderError) {
                paymentLogError(
                    'callback_rejected',
                    { provider: providerName, event },
                    err,
                );
                return {
                    status: 400,
                    body: {
                        success: false,
                        message: 'Invalid payment callback payload.',
                    },
                };
            }
            paymentLogError(
                'callback_processing_threw',
                { provider: providerName, event },
                err,
            );
            throw err;
        }

        if (result.outcome === 'ignored') {
            return { status: 200, body: { success: true } };
        }
        const txRow = await this.findTransactionForCallback(
            providerName,
            result,
            event === MPESA_CALLBACK_EVENTS.status ? callbackNonce : null,
        );
        if (!txRow) {
            // Nothing to reconcile (unknown/stale reference). Acknowledge so
            // the gateway does not retry forever.
            paymentLogWarn('callback_unmatched', {
                provider: providerName,
                event,
                reference: result.reference,
                providerRequestId: result.requestId,
                providerConversationId: result.conversationId,
                providerTransactionId: result.transactionId,
                outcome: result.outcome,
                providerMessage: result.message,
            });
            return { status: 200, body: { success: true } };
        }

        if (event === MPESA_CALLBACK_EVENTS.stk || event === MPESA_CALLBACK_EVENTS.status) {
            // The route verifies the signed URL; bind its nonce to this exact
            // payment for both STK and Transaction Status callbacks.
            const storedNonces = (txRow.callbackNonces ?? {}) as Record<
                string,
                string
            >;
            if (!callbackNonce || (txRow.reportOnly ? txRow.reportNonce ?? storedNonces[event] : storedNonces[event]) !== callbackNonce) {
                paymentLogWarn('callback_nonce_mismatch', {
                    transactionId: txRow.id,
                    provider: providerName,
                    event,
                    reference: result.reference,
                    providerConversationId: result.conversationId,
                    outcome: result.outcome,
                });
                return { status: 200, body: { success: true } };
            }
        }
        if (event === MPESA_CALLBACK_EVENTS.status) {
            // Persist authenticated callbacks before semantic validation so
            // failed, expired, and rejected results remain available for audit.
            await this.appendLog(
                txRow.id,
                txRow.provider,
                STATUS_CALLBACK_EVENT,
                result.payload,
                result.requestId,
                result.conversationId,
            );
            if (!txRow.reportOnly) {
                const [claim] = await db.select({ log: transactionLog, payment: packagePayments, pkg: packages, customerPhone: user.username })
                    .from(transactionLog)
                    .innerJoin(packagePayments, eq(packagePayments.transaction, transactionLog.transactionId))
                    .innerJoin(packages, eq(packages.id, packagePayments.packageId))
                    .innerJoin(user, eq(user.id, packagePayments.userId))
                    .where(and(eq(transactionLog.transactionId, txRow.id),
                        eq(transactionLog.eventType, STATUS_QUERY_EVENT),
                        sql`${transactionLog.payload}->>'purpose' = 'receipt_claim'`,
                        sql`${transactionLog.payload}->>'nonce' = ${callbackNonce}`,
                    )).limit(1);
                const requested = claim?.log.payload as {
                    receipt?: string; userId?: string; tenantAdminId?: string; nasDeviceId?: string;
                    packageType?: string; serviceAccountId?: string | null; phase?: string; customerPhone?: string;
                } | undefined;
                if (!claim || !requested || Date.now() - claim.log.createdAt.getTime() > 120_000 ||
                    requested.phase === 'rejected' || requested.phase === 'error' ||
                    requested.userId !== claim.payment.userId || requested.tenantAdminId !== claim.payment.tenantAdminId ||
                    requested.nasDeviceId !== claim.payment.nasDeviceId || requested.packageType !== claim.pkg.type ||
                    (requested.serviceAccountId && requested.serviceAccountId !== claim.payment.pppoeServiceAccountId) ||
                    (result.outcome === 'completed' && (requested.receipt !== result.transactionId?.toUpperCase() ||
                        result.amount === null || !normalizeMpesaPhoneNumber(result.payerPhoneNumber ?? '') ||
                        requested.customerPhone !== normalizeMpesaPhoneNumber(result.payerPhoneNumber ?? '') ||
                        requested.customerPhone !== normalizeMpesaPhoneNumber(claim.customerPhone ?? '') ||
                        requested.customerPhone !== normalizeMpesaPhoneNumber(claim.payment.phoneNumber)))) {
                    if (claim) await db.update(transactionLog).set({ payload: sql`${transactionLog.payload} || ${JSON.stringify({
                        phase: Date.now() - claim.log.createdAt.getTime() > 120_000 ? 'expired' : 'rejected',
                    })}::jsonb` }).where(eq(transactionLog.id, claim.log.id));
                    return { status: 200, body: { success: true } };
                }
                txRow.receiptClaim = true;
                if (result.outcome === 'pending') {
                    await db.update(transactionLog).set({ payload: sql`${transactionLog.payload} || '{"phase":"expired"}'::jsonb` })
                        .where(eq(transactionLog.id, claim.log.id));
                    return { status: 200, body: { success: true } };
                }
                // A failed lookup concerns the supplied receipt, not the
                // original checkout. Preserve pending/paid purchase state.
                if (result.outcome === 'failed') {
                    await db.update(transactionLog).set({ payload: sql`${transactionLog.payload} || '{"phase":"rejected"}'::jsonb` })
                        .where(eq(transactionLog.id, claim.log.id));
                    return { status: 200, body: { success: true } };
                }
            }
        }

        if (txRow.reportOnly && txRow.status !== 'completed') {
            paymentLogInfo('payment_report_ignored_for_transaction_state', {
                transactionId: txRow.id, provider: providerName, transactionStatus: txRow.status,
                outcome: result.outcome, providerMessage: result.message,
            });
            return { status: 200, body: { success: true } };
        }

        if (result.outcome === 'pending') {
            paymentLogInfo('callback_pending', {
                transactionId: txRow.id,
                provider: providerName,
                event,
                reference: result.reference,
                providerConversationId: result.conversationId,
                providerMessage: result.message,
            });
            return { status: 200, body: { success: true } };
        }

        if (event === MPESA_CALLBACK_EVENTS.stk && result.outcome === 'completed') {
            await this.appendLog(txRow.id, txRow.provider, 'stk_callback_received', result.payload,
                result.requestId, result.conversationId);
            if (!result.transactionId || result.amount === null || !result.payerPhoneNumber) {
                paymentLogWarn('callback_missing_payment_details', { transactionId: txRow.id, provider: providerName, event });
                return { status: 200, body: { success: true } };
            }
        }
        if (AUTOMATIC_STATUS_POLLING_ENABLED && event === MPESA_CALLBACK_EVENTS.stk && result.outcome === 'completed') {
            // With fallback queries enabled, independently confirm checkout
            // status before applying callback metadata.
            if (provider.name !== providerName) {
                paymentLogWarn('callback_could_not_be_authenticated', { transactionId: txRow.id, provider: providerName });
                return { status: 200, body: { success: true } };
            }
            const [payment] = await db.select().from(packagePayments)
                .where(eq(packagePayments.transaction, txRow.id)).limit(1);
            if (payment) {
                if (txRow.status === 'completed') {
                    const receipt = await this.receiptFromStkCallback(txRow, provider, payment);
                    if (receipt) await this.applyOutcome(txRow, 'completed', {
                        enrichmentOnly: true, transactionId: receipt, source: 'verified_stk_callback',
                        message: result.message, amount: result.amount,
                    });
                    return { status: 200, body: { success: true } };
                }
                const status = await this.refreshPackagePaymentStatus(payment);
                if (status !== 'paid') paymentLogInfo('callback_not_confirmed_by_status_query', {
                    transactionId: txRow.id, provider: providerName, status,
                });
            }
            return { status: 200, body: { success: true } };
        }

        paymentLogInfo('callback_matched', {
            transactionId: txRow.id,
            provider: providerName,
            event,
            reference: result.reference,
            providerRequestId: result.requestId,
            providerConversationId: result.conversationId,
            providerTransactionId: result.transactionId,
            amount: result.amount,
            outcome: result.outcome,
        });

        if (result.outcome === 'completed') {
            if (
                event === MPESA_CALLBACK_EVENTS.status &&
                result.amount === null &&
                Number(txRow.amount) > 0
            ) {
                paymentLogWarn('callback_missing_payment_amount', {
                    transactionId: txRow.id,
                    provider: providerName,
                    event,
                    reference: result.reference,
                    providerTransactionId: result.transactionId,
                });
                return { status: 200, body: { success: true } };
            }
            // An STK status query confirms the exact checkout request that the
            // server created with the package amount, so it remains a safe
            // callback-loss fallback even though Safaricom omits amount from
            // the query response. Manual receipt verification is different:
            // its status callback must report and match the package amount.
            const mismatch = await this.amountMismatch(txRow, result.amount);
            // Payer binding: refuse completion when the gateway reports a
            // different payer than the phone number on the linked package
            // payment. Skipped when either side is absent — some Safaricom
            // payloads omit the MSISDN/PhoneNumber, in which case the amount
            // match and (for status) the stored-nonce check still apply.
            const rejection =
                mismatch ??
                (await this.payerMismatchForTransaction(
                    txRow,
                    result.payerPhoneNumber,
                    { provider: providerName, event },
                ));
            if (rejection) {
                if (txRow.receiptClaim) {
                    await db.update(transactionLog).set({ payload: sql`${transactionLog.payload} || '{"phase":"rejected"}'::jsonb` })
                        .where(and(eq(transactionLog.transactionId, txRow.id), eq(transactionLog.eventType, STATUS_QUERY_EVENT),
                            sql`${transactionLog.payload}->>'purpose' = 'receipt_claim'`,
                            sql`${transactionLog.payload}->>'nonce' = ${callbackNonce}`));
                    return { status: 200, body: { success: true } };
                }
                await this.applyOutcome(txRow, 'failed', {
                    enrichmentOnly: txRow.reportOnly,
                    transactionId: result.transactionId,
                    source: `callback_${event}`,
                    message: rejection,
                    amount: result.amount,
                    payload: { ...result.payload, message: rejection },
                    requestId: result.requestId,
                    conversationId: result.conversationId,
                });
                return { status: 200, body: { success: true } };
            }
            await this.applyOutcome(txRow, 'completed', {
                enrichmentOnly: txRow.reportOnly,
                verifiedReceipt: txRow.receiptClaim,
                verificationNonce: txRow.receiptClaim ? callbackNonce : undefined,
                transactionId: txRow.receiptClaim ? result.transactionId?.toUpperCase() : result.transactionId,
                source: `callback_${event}`,
                message: result.message,
                amount: result.amount,
                payload: result.payload,
                requestId: result.requestId,
                conversationId: result.conversationId,
            });
            return { status: 200, body: { success: true } };
        }

        await this.applyOutcome(txRow, 'failed', {
            enrichmentOnly: txRow.reportOnly,
            transactionId: result.transactionId,
            source: `callback_${event}`,
            message: result.message,
            clientFailure: result.clientFailure,
            amount: result.amount,
            payload: result.payload,
            requestId: result.requestId,
            conversationId: result.conversationId,
        });
        return { status: 200, body: { success: true } };
    }

    // --- Internals --------------------------------------------------------------

    private async receiptClaimForPayment(
        payment: PackagePaymentRow,
        packageType: 'hotspot' | 'pppoe',
        scope: ReceiptClaimScope,
    ): Promise<VerifyByCodeOutcome> {
        if (payment.status !== 'paid') return {
            paymentId: payment.id, status: payment.status,
            message: 'This payment has not been completed.',
        };
        let history = await this.claimActivationDetails(payment.id);
        let recovered = false;
        let recoveryFailed = false;
        if (!history) {
            try {
                recovered = await radiusClient.recoverUnactivatedPayment(payment.id);
            } catch (error) {
                recoveryFailed = true;
                logger.error('Receipt claim activation failed', { paymentId: payment.id, error });
            }
            history = await this.claimActivationDetails(payment.id);
        }
        if (!history || recoveryFailed) return {
            paymentId: payment.id, status: 'paid', claimOutcome: 'activation_pending',
            activationDetails: null, activation: null,
            message: 'Payment confirmed. Package activation is not complete yet. Try again shortly.',
        };
        if (history.active) {
            try {
                if (!await radiusClient.activationCredentialsReady(history.activationId, packageType) &&
                    !await radiusClient.repairClaimCredentials(payment.id)) {
                    return { paymentId: payment.id, status: 'paid', claimOutcome: 'activation_pending',
                        activationDetails: { ...history, active: false }, activation: null,
                        message: 'Payment confirmed. Package access could not be restored yet. Try again shortly.' };
                }
            } catch (error) {
                logger.error('Receipt claim credential repair failed', { paymentId: payment.id, error });
                return { paymentId: payment.id, status: 'paid', claimOutcome: 'activation_pending',
                    activationDetails: { ...history, active: false }, activation: null,
                    message: 'Payment confirmed. Package access could not be restored yet. Try again shortly.' };
            }
        }
        const activation = packageType === 'hotspot' && history.active
            ? await radiusClient.existingPaymentRedirect(payment.id, scope.loginRequestId).catch(() => null) : null;
        return {
            paymentId: payment.id, status: 'paid',
            claimOutcome: recovered ? 'activated' : 'already_activated',
            activationDetails: history, activation,
            message: recovered ? 'Payment verified and package activated.' : 'This payment was already activated.',
        };
    }

    private async claimActivationDetails(paymentId: string): Promise<PaymentClaimActivationDetails | null> {
        const [row] = await db.select({ activation: activatedPackages, pkg: packages, nasDeviceName: nasDevice.name,
            accountStatus: pppoeServiceAccounts.status })
            .from(activatedPackages)
            .innerJoin(packages, eq(packages.id, activatedPackages.packageId))
            .innerJoin(packagePayments, eq(packagePayments.id, activatedPackages.packagePaymentId))
            .leftJoin(nasDevice, eq(nasDevice.id, packagePayments.nasDeviceId))
            .leftJoin(pppoeServiceAccounts, eq(pppoeServiceAccounts.id, activatedPackages.pppoeServiceAccountId))
            .where(eq(activatedPackages.packagePaymentId, paymentId)).limit(1);
        if (!row) return null;
        const { activation, pkg } = row;
        let active = activation.deactivatedAt === null && activation.expireAt.getTime() > Date.now() &&
            (pkg.type !== 'pppoe' || row.accountStatus === 'active');
        if (active && (pkg.noExpiry || activation.timeAllowanceSeconds !== null)) {
            const usage = await radiusClient.getBankUsage(activation.id);
            active = Boolean(usage && usage.remainingSeconds > 0);
        }
        return {
            activationId: activation.id, packageTitle: pkg.title,
            nasDeviceName: row.nasDeviceName ?? '',
            activatedAt: activation.activatedAt.toISOString(), expireAt: activation.expireAt.toISOString(),
            noExpiry: pkg.noExpiry, sessionLength: pkg.sessionLength, active,
        };
    }

    private async getTransaction(id: string): Promise<TransactionRow | null> {
        const [row] = await db
            .select()
            .from(transaction)
            .where(eq(transaction.id, id))
            .limit(1);
        return row ?? null;
    }

    private async findTransactionForCallback(
        providerName: string,
        result: ProviderCallbackResult,
        callbackNonce?: string | null,
    ): Promise<(TransactionRow & { reportOnly?: boolean; reportNonce?: string; receiptClaim?: boolean }) | null> {
        if (result.reference) {
            const [row] = await db
                .select()
                .from(transaction)
                .where(
                    and(
                        eq(transaction.provider, providerName),
                        eq(transaction.providerReference, result.reference),
                    ),
                )
                .limit(1);
            if (row) return row;
        }

        // The signed nonce is persisted before dispatch. It can safely bind
        // a fast report callback even before the acknowledgment/correlation
        // log arrives. Prefer it over payload conversation IDs. Even stale
        // reports are attributed; the handler never authorizes from a report.
        if (callbackNonce) {
            const [report] = await db.select({ log: transactionLog, tx: transaction }).from(transactionLog)
                .innerJoin(transaction, eq(transaction.id, transactionLog.transactionId))
                .where(and(eq(transaction.provider, providerName),
                    eq(transactionLog.eventType, STATUS_QUERY_EVENT),
                    sql`${transactionLog.payload}->>'purpose' in ('payment_report', 'admin_reconcile')`,
                    sql`${transactionLog.payload}->>'phase' = 'requested'`,
                    sql`${transactionLog.payload}->>'nonce' = ${callbackNonce}`)).limit(1);
            if (report) return { ...report.tx, reportOnly: true, reportNonce: callbackNonce };
            const [claim] = await db.select({ log: transactionLog, tx: transaction }).from(transactionLog)
                .innerJoin(transaction, eq(transaction.id, transactionLog.transactionId))
                .where(and(eq(transaction.provider, providerName),
                    eq(transactionLog.eventType, STATUS_QUERY_EVENT),
                    sql`${transactionLog.payload}->>'purpose' = 'receipt_claim'`,
                    sql`${transactionLog.payload}->>'nonce' = ${callbackNonce}`,
                    sql`${transaction.callbackNonces}->>${MPESA_CALLBACK_EVENTS.status} = ${callbackNonce}`,
                )).limit(1);
            if (claim) {
                return { ...claim.tx, receiptClaim: true };
            }
            const [row] = await db.select().from(transaction).where(and(
                eq(transaction.provider, providerName),
                eq(transaction.status, 'completed'),
                sql`${transaction.callbackNonces}->>${MPESA_CALLBACK_EVENTS.status} = ${callbackNonce}`,
                sql`exists (select 1 from ${transactionLog} where ${transactionLog.transactionId} = ${transaction.id}
                    and ${transactionLog.eventType} = ${STATUS_QUERY_EVENT}
                    and ${transactionLog.payload}->>'purpose' in ('payment_report', 'admin_reconcile'))`,
            )).limit(1);
            if (row) return { ...row, reportOnly: true };
        }
        // Compatibility for persisted attempts predating per-report nonces.
        // The handler still verifies the transaction's stored signed nonce.
        if (result.conversationId) {
            const [queryLog] = await db.select().from(transactionLog).where(and(
                eq(transactionLog.provider, providerName), eq(transactionLog.eventType, STATUS_QUERY_EVENT),
                eq(transactionLog.providerConversationId, result.conversationId),
            )).limit(1);
            if (queryLog) {
                const row = await this.getTransaction(queryLog.transactionId);
                const claim = queryLog.payload as { purpose?: string; nonce?: string; receipt?: string };
                if (claim?.purpose === 'receipt_claim' && claim.nonce !== callbackNonce) return null;
                return row ? { ...row, reportOnly: claim?.purpose === 'payment_report' || claim?.purpose === 'admin_reconcile',
                    reportNonce: claim?.purpose === 'receipt_claim' ? undefined : claim?.nonce,
                    receiptClaim: claim?.purpose === 'receipt_claim' } : null;
            }
        }
        return null;
    }

    // Guards against a receipt that is real but for the wrong amount (the
    // legacy flow matched payments by amount for the same reason).
    private async amountMismatch(
        txRow: TransactionRow,
        reportedAmount: number | null,
    ): Promise<string | null> {
        if (reportedAmount === null) return null;
        const expected = Number(txRow.amount);
        // 0 is the placeholder amount of receipt-verification rows, which only
        // learn the real amount from the gateway callback.
        if (!Number.isFinite(expected) || expected === 0) return null;
        if (expected !== reportedAmount) {
            return `Payment amount mismatch: the package costs ${expected} but the provider reported ${reportedAmount}.`;
        }
        return null;
    }

    // Payer binding: compares the gateway-reported payer number with the
    // phone number on the package payment. Returns a rejection message on
    // mismatch, or null to proceed. Limitation: when either side is
    // absent/unparseable the check is skipped (not every gateway payload
    // reports the payer); the amount and nonce guards still apply.
    private payerMismatch(
        expectedPhoneNumber: string | null | undefined,
        reportedPayer: string | null | undefined,
        context: Record<string, unknown>,
    ): string | null {
        if (!reportedPayer) return null;
        const expected = normalizeMpesaPhoneNumber(expectedPhoneNumber ?? '');
        if (!expected || expected === reportedPayer) return null;
        paymentLogWarn('payer_mismatch', {
            ...context,
            expectedPayer: expected,
            reportedPayer,
        });
        return 'This receipt was paid from a different phone number than the one on the payment.';
    }

    // Payer binding for callback reconciliation: loads the package payment
    // linked through the transaction metadata and defers to payerMismatch.
    private async payerMismatchForTransaction(
        txRow: TransactionRow,
        reportedPayer: string | null,
        context: Record<string, unknown>,
    ): Promise<string | null> {
        if (!reportedPayer) return null;
        const packagePaymentId = (
            txRow.metadata as { packagePaymentId?: string } | null
        )?.packagePaymentId;
        if (!packagePaymentId) return null;
        const [payment] = await db
            .select({ phoneNumber: packagePayments.phoneNumber })
            .from(packagePayments)
            .where(eq(packagePayments.id, packagePaymentId))
            .limit(1);
        return this.payerMismatch(payment?.phoneNumber, reportedPayer, {
            transactionId: txRow.id,
            paymentId: packagePaymentId,
            ...context,
        });
    }

    // Flips the transaction (and any linked package payment) to a final state
    // and records the provider event. Final states never change; successful
    // late callbacks can only enrich completed transactions. A purchase also
    // triggers RADIUS activation here (fire-and-forget: the payment is already
    // settled, and GET /payment/:id re-asserts activation idempotently).
    private async applyOutcome(
        txRow: TransactionRow,
        outcome: Exclude<PaymentOutcome, 'pending'>,
        details: {
            transactionId?: string | null;
            source: string;
            message: string;
            clientFailure?: ClientPaymentFailure;
            // Amount reported by the gateway; recorded on the transaction
            // (receipt-verification rows carry a 0 placeholder until now).
            amount?: number | null;
            payload?: Record<string, unknown>;
            requestId?: string | null;
            conversationId?: string | null;
            enrichmentOnly?: boolean;
            verifiedReceipt?: boolean;
            verificationNonce?: string | null;
        },
    ): Promise<boolean> {
        let transitioned = false;
        await db.transaction(async (trx) => {
            let enriched = false;
            let receiptRejected = false;
            if (details.transactionId && outcome === 'completed') {
                const [current] = await trx.select({ receipt: transaction.providerTransactionId, nonces: transaction.callbackNonces }).from(transaction)
                    .where(eq(transaction.id, txRow.id)).for('update');
                // No schema change: serialize receipt assignment globally,
                // including receipts shared across tenant provider names.
                await trx.execute(sql`select pg_advisory_xact_lock(hashtext(${details.transactionId}))`);
                const [used] = await trx.select({ id: transaction.id }).from(transaction)
                    .where(and(eq(transaction.providerTransactionId, details.transactionId),
                        eq(transaction.status, 'completed'))).limit(1);
                receiptRejected = Boolean((used && used.id !== txRow.id) ||
                    (current?.receipt && current.receipt !== details.transactionId) ||
                    (details.verifiedReceipt && (current?.nonces as Record<string, string> | null)?.[MPESA_CALLBACK_EVENTS.status] !== details.verificationNonce));
            }
            const updated = details.enrichmentOnly || receiptRejected ? [] : await trx
                .update(transaction)
                .set({
                    status: outcome,
                    ...(details.transactionId && outcome === 'completed'
                        ? { providerTransactionId: details.transactionId }
                        : {}),
                    ...(details.amount && details.amount > 0
                        ? { amount: String(details.amount) }
                        : {}),
                })
                .where(
                    and(
                        eq(transaction.id, txRow.id),
                        details.verifiedReceipt && outcome === 'completed'
                            ? inArray(transaction.status, ['pending', 'failed']) : eq(transaction.status, 'pending'),
                    ),
                )
                .returning({ id: transaction.id });
            transitioned = updated.length > 0;

            if (!transitioned && !receiptRejected && outcome === 'completed' &&
                (details.transactionId || (details.amount && details.amount > 0))) {
                const rows = await trx.update(transaction).set({
                    ...(details.transactionId ? { providerTransactionId: details.transactionId } : {}),
                    ...(details.amount && details.amount > 0 ? { amount: String(details.amount) } : {}),
                }).where(and(eq(transaction.id, txRow.id), eq(transaction.status, 'completed')))
                    .returning({ id: transaction.id });
                enriched = rows.length > 0;
            }

            if (transitioned) {
                await trx
                    .update(packagePayments)
                    .set({
                        status: outcome === 'completed' ? 'paid' : 'failed',
                    })
                    .where(
                        and(
                            eq(packagePayments.transaction, txRow.id),
                            details.verifiedReceipt && outcome === 'completed'
                                ? inArray(packagePayments.status, ['pending', 'failed']) : eq(packagePayments.status, 'pending'),
                        ),
                    );
            }

            await trx.insert(transactionLog).values({
                transactionId: txRow.id,
                provider: txRow.provider,
                eventType: transitioned
                    ? outcome === 'completed'
                        ? `payment_completed_${details.source}`
                        : `payment_failed_${details.source}`
                    : enriched ? `payment_enriched_${details.source}`
                    : `payment_outcome_ignored_${details.source}`,
                payload: transitioned || enriched
                    ? {
                          ...(details.payload ?? { message: details.message }),
                          clientFailure: details.clientFailure ?? null,
                      }
                    : {
                          ...details.payload,
                          requestedOutcome: outcome,
                          message: details.message,
                          ...(receiptRejected ? { rejection: 'Receipt already assigned or conflicts with this transaction.' } : {}),
                      },
                providerRequestId: details.requestId ?? null,
                providerConversationId: details.conversationId ?? null,
            });
        });

        paymentLogInfo('outcome_applied', {
            transactionId: txRow.id,
            provider: txRow.provider,
            providerTransactionId: details.transactionId,
            source: details.source,
            outcome,
            transitioned,
            amount: details.amount ?? null,
            providerMessage: details.message,
        });

        if (transitioned && outcome === 'completed') {
            const packagePaymentId = (
                txRow.metadata as { packagePaymentId?: string } | null
            )?.packagePaymentId;
            if (packagePaymentId) {
                void radiusClient
                    .recoverUnactivatedPayment(packagePaymentId)
                    .catch((err) =>
                        logger.error('RADIUS payment activation failed', {
                            paymentId: packagePaymentId,
                            error: err,
                        }),
                    );
            }
        }
        return transitioned;
    }

    private async getPackagePaymentStatus(
        paymentId: string,
        fallback: PackagePaymentRow['status'],
    ): Promise<PackagePaymentRow['status']> {
        const [row] = await db
            .select({ status: packagePayments.status })
            .from(packagePayments)
            .where(eq(packagePayments.id, paymentId))
            .limit(1);
        return row?.status ?? fallback;
    }

    async getPaymentFailureMessage(payment: PackagePaymentRow): Promise<string> {
        if (!payment.transaction) return paymentFailureMessage(undefined);
        const [event] = await db
            .select({ payload: transactionLog.payload })
            .from(transactionLog)
            .where(
                and(
                    eq(transactionLog.transactionId, payment.transaction),
                    sql`starts_with(${transactionLog.eventType}, 'payment_failed_')`,
                ),
            )
            .orderBy(desc(transactionLog.createdAt))
            .limit(1);
        // Never interpret historical raw gateway messages as client-safe text.
        return paymentFailureMessage(
            (event?.payload as { clientFailure?: unknown } | null)?.clientFailure,
        );
    }

    private async appendLog(
        transactionId: string,
        providerName: string,
        eventType: string,
        payload: Record<string, unknown>,
        providerRequestId: string | null = null,
        providerConversationId: string | null = null,
    ): Promise<void> {
        await db.insert(transactionLog).values({
            transactionId,
            provider: providerName,
            eventType,
            payload,
            providerRequestId,
            providerConversationId,
        });
    }
}
