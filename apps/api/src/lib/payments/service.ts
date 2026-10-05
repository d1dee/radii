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

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db';
import {
    packagePayments,
    nasDevice,
    packages,
    transaction,
    transactionLog,
} from '../../db/schema';
import { env } from '../../env';
import { apiLogger } from '../../logging';
import { getAdminIdForNasDevice, getAdminIdForUser } from '../adminSettings';
import { getPaymentByTransactionCode, type PackageRow } from '../packages';
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
}

const STATUS_QUERY_EVENT = 'status_query';
const STATUS_CALLBACK_EVENT = 'status_callback';
// Providers that deliver callbacks resolve payments on their own, so the
// fallback poll-by-reference only needs to run every this often.
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
    // Last time we polled the gateway for a transaction's status (by
    // transaction id). In-memory only: a restart just costs one immediate
    // poll, which is fine.
    private lastStatusPoll = new Map<string, number>();
    private reconciliationInFlight = new Map<string, Promise<void>>();
    private reportsInFlight = new Map<string, Promise<void>>();

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
        if (payment.status !== 'pending' || !payment.transaction) {
            return payment.status;
        }

        const txRow = await this.getTransaction(payment.transaction);
        if (!txRow) return payment.status;

        const provider = await this.resolveProvider(txRow.provider);
        if (!provider || !txRow.providerReference) return payment.status;

        // Callback-capable providers resolve payments via webhook; throttle
        // the fallback poll so rapid client polls don't rate-limit us at the
        // gateway. Poll-only providers are queried on every poll.
        if (provider.handleCallback) {
            const now = Date.now();
            const last = this.lastStatusPoll.get(txRow.id);
            if (last !== undefined && now - last < STATUS_POLL_INTERVAL_MS) {
                return payment.status;
            }
            this.lastStatusPoll.set(txRow.id, now);
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
            return payment.status;
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
        if (result.outcome === 'completed') {
            const transitioned = await this.applyOutcome(txRow, 'completed', {
                transactionId: result.transactionId,
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
        return payment.status;
    }

    async canQueryTransactionStatus(transactionId: string): Promise<boolean> {
        const tx = await this.getTransaction(transactionId);
        if (!tx?.providerReference || await this.hasPaymentCallback(tx.id)) return false;
        const [prior] = await db.select({ id: transactionLog.id })
            .from(transactionLog).where(and(
                eq(transactionLog.transactionId, tx.id),
                eq(transactionLog.eventType, STATUS_QUERY_EVENT),
                sql`${transactionLog.payload}->>'purpose' = 'admin_reconcile'`,
            )).limit(1);
        if (prior) return false;
        try {
            return Boolean((await this.resolveProvider(tx.provider))?.handleCallback);
        } catch {
            return false;
        }
    }

    private async hasPaymentCallback(transactionId: string): Promise<boolean> {
        const [callback] = await db.select({ id: transactionLog.id })
            .from(transactionLog).where(and(
                eq(transactionLog.transactionId, transactionId),
                sql`(${transactionLog.eventType} = ${STATUS_CALLBACK_EVENT}
                    or ${transactionLog.eventType} like '%callback_%')`,
            )).limit(1);
        return Boolean(callback);
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
            if (!tx?.providerReference || !await this.canQueryTransactionStatus(tx.id)) return;
            const provider = await this.resolveProvider(tx.provider);
            if (!provider?.handleCallback) return;
            const claimed = await db.transaction(async (trx) => {
                await trx.select({ id: transaction.id }).from(transaction)
                    .where(eq(transaction.id, tx.id)).for('update');
                const [prior] = await trx.select({ id: transactionLog.id })
                    .from(transactionLog).where(and(
                        eq(transactionLog.transactionId, tx.id),
                        eq(transactionLog.eventType, STATUS_QUERY_EVENT),
                        sql`${transactionLog.payload}->>'purpose' = 'admin_reconcile'`,
                    )).limit(1);
                if (prior) return false;
                const [scoped] = await trx.select({ id: packagePayments.id })
                    .from(packagePayments).innerJoin(nasDevice, eq(nasDevice.id, packagePayments.nasDeviceId))
                    .where(and(eq(packagePayments.id, paymentId), eq(nasDevice.ownerId, adminId))).limit(1);
                const [callback] = await trx.select({ id: transactionLog.id }).from(transactionLog)
                    .where(and(eq(transactionLog.transactionId, tx.id),
                        sql`(${transactionLog.eventType} = ${STATUS_CALLBACK_EVENT} or ${transactionLog.eventType} like '%callback_%')`)).limit(1);
                if (!scoped || callback) return false;
                await trx.insert(transactionLog).values({
                    transactionId: tx.id, provider: tx.provider, eventType: STATUS_QUERY_EVENT,
                    payload: { purpose: 'admin_reconcile', phase: 'requested' },
                });
                return true;
            });
            if (!claimed) return;
            try {
                const result = await provider.getPaymentStatus(tx.providerReference);
                await this.appendLog(tx.id, tx.provider, STATUS_QUERY_EVENT, {
                    purpose: 'admin_reconcile', phase: 'result', outcome: result.outcome,
                    message: result.message,
                });
                if (result.outcome !== 'pending') {
                    await this.applyOutcome(tx, result.outcome, {
                        source: 'admin_status_query', message: result.message,
                        transactionId: result.transactionId, clientFailure: result.clientFailure,
                    });
                    if (result.outcome === 'completed') {
                        void this.requestPaymentReport(tx, provider).catch((error) =>
                            paymentLogError('payment_report_threw', { transactionId: tx.id, provider: tx.provider }, error));
                    }
                }
            } catch (error) {
                paymentLogError('admin_status_query_threw', { paymentId, transactionId: tx.id, provider: tx.provider }, error);
                await this.appendLog(tx.id, tx.provider, STATUS_QUERY_EVENT, {
                    purpose: 'admin_reconcile', phase: 'error', message: PAYMENT_UNAVAILABLE_MESSAGE,
                });
            }
        })();
        this.reconciliationInFlight.set(key, work);
        try { await work; return visible; }
        finally { this.reconciliationInFlight.delete(key); }
    }

    private async requestPaymentReport(txRow: TransactionRow, provider: PaymentProvider): Promise<void> {
        if (!provider.requestPaymentReport) return;
        const existing = this.reportsInFlight.get(txRow.id);
        if (existing) return existing;
        const work = (async () => {
            const claim = await db.transaction(async (trx) => {
                const [tx] = await trx.select().from(transaction)
                    .where(eq(transaction.id, txRow.id)).for('update');
                if (!tx || tx.status !== 'completed') return null;
                const [prior] = await trx.select({ id: transactionLog.id }).from(transactionLog)
                    .where(and(eq(transactionLog.transactionId, tx.id), eq(transactionLog.eventType, STATUS_QUERY_EVENT),
                        sql`${transactionLog.payload}->>'purpose' = 'payment_report'`)).limit(1);
                if (prior) return null;
                const [initiated] = await trx.select({ requestId: transactionLog.providerRequestId }).from(transactionLog)
                    .where(and(eq(transactionLog.transactionId, tx.id), eq(transactionLog.eventType, 'payment_initiated')))
                    .orderBy(desc(transactionLog.createdAt)).limit(1);
                if (!tx.providerTransactionId && !initiated?.requestId) return null;
                const nonces = (tx.callbackNonces ?? {}) as Record<string, string>;
                const nonce = nonces[MPESA_CALLBACK_EVENTS.status] ?? newCallbackNonce();
                await trx.update(transaction).set({ callbackNonces: { ...nonces, [MPESA_CALLBACK_EVENTS.status]: nonce } })
                    .where(eq(transaction.id, tx.id));
                await trx.insert(transactionLog).values({ transactionId: tx.id, provider: tx.provider,
                    eventType: STATUS_QUERY_EVENT, payload: { purpose: 'payment_report', phase: 'requested' },
                    providerRequestId: initiated?.requestId ?? null });
                return { tx, nonce, requestId: initiated?.requestId ?? null };
            });
            if (!claim) return;
            try {
                const result = await provider.requestPaymentReport!({
                    transactionId: claim.tx.providerTransactionId, requestId: claim.requestId,
                }, { callbackBaseUrl: this.callbackBaseUrl(provider.name), callbackNonce: claim.nonce });
                await this.appendLog(txRow.id, provider.name, STATUS_QUERY_EVENT, {
                    ...result.data, purpose: 'payment_report', phase: 'result', outcome: result.outcome, message: result.message,
                }, claim.requestId, result.conversationId);
                if (result.outcome === 'completed') {
                    const rejection = await this.amountMismatch(claim.tx, result.amount ?? null)
                        ?? await this.payerMismatchForTransaction(claim.tx, result.payerPhoneNumber ?? null, { source: 'payment_report' });
                    if (!rejection) await this.applyOutcome(claim.tx, 'completed', {
                        source: 'payment_report', enrichmentOnly: true, message: result.message,
                        transactionId: claim.tx.providerTransactionId, amount: result.amount,
                        conversationId: result.conversationId,
                    });
                }
            } catch (error) {
                paymentLogError('payment_report_threw', { transactionId: txRow.id, provider: provider.name }, error);
                await this.appendLog(txRow.id, provider.name, STATUS_QUERY_EVENT, {
                    purpose: 'payment_report', phase: 'error', message: PAYMENT_UNAVAILABLE_MESSAGE,
                });
            }
        })();
        this.reportsInFlight.set(txRow.id, work);
        try { await work; }
        finally { this.reportsInFlight.delete(txRow.id); }
    }

    // Verifies a gateway transaction number supplied by the customer (e.g. an
    // M-Pesa receipt code pasted into the "having issues" form). Mirrors the
    // legacy verifyTransactionHandler flow:
    //  1. Known receipt: a package payment already carries it -> report its
    //     state as-is (package link + activation checked later, see TODO).
    //  2. Known verification transaction (submitted earlier, callback already
    //     applied) -> report the gateway outcome.
    //  3. Verification already in flight -> keep reporting pending.
    //  4. Otherwise submit a fresh verification to the provider. The outcome
    //     arrives asynchronously via the status callback
    //     (handleProviderCallback) and the client converges by re-calling
    //     this endpoint until the payment leaves pending.
    async verifyTransactionCode(
        userId: string,
        rawCode: string,
        tenantAdminId?: string,
        packageType?: 'hotspot' | 'pppoe',
    ): Promise<VerifyByCodeOutcome | null> {
        const code = rawCode.trim().toUpperCase();

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

        // 1. A package payment already carries this receipt.
        const payment = await getPaymentByTransactionCode(code);
        if (payment) {
            if (
                payment.userId !== userId ||
                (tenantAdminId && payment.tenantAdminId !== tenantAdminId)
            )
                return null;
            // Paid but never activated (e.g. callback arrived before the
            // client polled): activate now — idempotent.
            const activation =
                payment.status === 'paid'
                    ? await radiusClient
                          .ensureActivated(payment.id)
                          .catch((err) => {
                              logger.error('RADIUS payment activation failed', {
                                  paymentId: payment.id,
                                  error: err,
                              });
                              return null;
                          })
                    : null;
            return {
                paymentId: payment.id,
                status: payment.status,
                activation,
                message:
                    payment.status === 'paid'
                        ? 'This payment has already been completed.'
                        : payment.status === 'failed'
                          ? 'This payment was not completed. Check the receipt number and try again.'
                          : 'This payment is still being processed.',
            };
        }

        // 2. A verification transaction for this receipt (created when the
        // code was first submitted) — the status callback reconciles it.
        const family = this.providerFamilyNames(provider.name);
        const known = await this.findTransactionByCode(family, code);
        if (known) {
            if (known.userId !== userId) return null;
            paymentLogWarn('unlinked_verification_transaction_found', {
                transactionId: known.id,
                userId,
                provider: known.provider,
                receipt: code,
                status: known.status,
            });
            return null;
        }

        // 3. An in-flight verification whose row we could not match above
        // (e.g. callback still in transit): keep the client polling.
        const [pendingQuery] = await db
            .select({
                log: transactionLog,
                transactionStatus: transaction.status,
            })
            .from(transactionLog)
            .innerJoin(
                transaction,
                eq(transaction.id, transactionLog.transactionId),
            )
            .where(
                and(
                    inArray(transactionLog.provider, family),
                    eq(transactionLog.eventType, STATUS_QUERY_EVENT),
                    sql`${transactionLog.payload}->>'receipt' = ${code}`,
                    eq(transaction.userId, userId),
                ),
            )
            .orderBy(desc(transactionLog.createdAt))
            .limit(1);
        if (pendingQuery?.log.providerConversationId) {
            const [callback] = await db
                .select({ id: transactionLog.id })
                .from(transactionLog)
                .where(
                    and(
                        inArray(transactionLog.provider, family),
                        eq(transactionLog.eventType, STATUS_CALLBACK_EVENT),
                        eq(
                            transactionLog.providerConversationId,
                            pendingQuery.log.providerConversationId,
                        ),
                    ),
                )
                .limit(1);
            if (!callback) {
                return {
                    paymentId: null,
                    status: 'pending',
                    message:
                        'Verification is still in progress. Check back in a moment.',
                };
            }
        }

        const pendingConditions = [
            eq(packagePayments.userId, userId),
            eq(packagePayments.status, 'pending'),
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
            .select({ payment: packagePayments, tx: transaction })
            .from(packagePayments)
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

        // 4. Submit a fresh verification to the provider.
        //
        // Mint the status-callback nonce first and bind it to the
        // transaction row: the async status callback carries it in its
        // signed ?ct= token and is only accepted when it matches, so a
        // forged (or replayed from another transaction) status callback
        // cannot complete this payment. Pending verifications retire earlier
        // attempts; if polling completed it meanwhile, preserve any report URL.
        const statusCallbackNonce = await db.transaction(async (trx) => {
            const [current] = await trx.select().from(transaction)
                .where(eq(transaction.id, target.tx.id)).for('update');
            const nonces = (current?.callbackNonces ?? {}) as Record<string, string>;
            const nonce = current?.status === 'completed'
                ? nonces[MPESA_CALLBACK_EVENTS.status] ?? newCallbackNonce()
                : newCallbackNonce();
            await trx.update(transaction).set({
                callbackNonces: { ...nonces, [MPESA_CALLBACK_EVENTS.status]: nonce },
            }).where(eq(transaction.id, target.tx.id));
            return nonce;
        });

        let result;
        try {
            result = await provider.verifyTransaction(code, {
                callbackBaseUrl: this.callbackBaseUrl(provider.name),
                callbackNonce: statusCallbackNonce,
            });
        } catch (err) {
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
                const rejected = await this.applyOutcome(
                    target.tx,
                    'failed',
                    {
                        transactionId: code,
                        source: 'receipt_verification',
                        message: rejection,
                        amount: result.amount ?? null,
                    },
                );
                return {
                    paymentId: target.payment.id,
                    status: rejected
                        ? 'failed'
                        : await this.getPackagePaymentStatus(
                              target.payment.id,
                              target.payment.status,
                          ),
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
                },
            );
            const status = transitioned
                ? 'paid'
                : await this.getPackagePaymentStatus(
                      target.payment.id,
                      target.payment.status,
                  );
            return {
                paymentId: target.payment.id,
                status,
                message:
                    status === 'paid'
                        ? 'Payment verified.'
                        : 'The receipt was verified, but the payment state changed. Refresh and try again.',
            };
        }

        if (result.conversationId) {
            await this.appendLog(
                target.tx.id,
                provider.name,
                STATUS_QUERY_EVENT,
                {
                    receipt: code,
                    userId,
                    ...result.data,
                },
                null,
                result.conversationId,
            );
        }

        return {
            paymentId: target.payment.id,
            status: 'pending',
            message: 'Waiting for the provider to confirm this transaction...',
        };
    }

    // Dispatches an inbound webhook to the owning provider and reconciles the
    // referenced transaction. Returns the HTTP response for the gateway.
    // callbackNonce is the nonce from the route-verified signed ?ct= token
    // (see ./callbackToken.ts); status callbacks are additionally bound to
    // the transaction row that issued the verification URL through it.
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
            });
            return { status: 200, body: { success: true } };
        }

        if (event === MPESA_CALLBACK_EVENTS.status) {
            // Safaricom's Transaction Status callbacks carry no signature of
            // their own: the signed URL token's nonce must equal the one
            // stored on this transaction when the status query was submitted
            // (verifyTransactionCode). This is what authenticates status
            // completions, together with the amount-match below.
            const storedNonces = (txRow.callbackNonces ?? {}) as Record<
                string,
                string
            >;
            if (!callbackNonce || storedNonces[event] !== callbackNonce) {
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
            await this.appendLog(
                txRow.id,
                txRow.provider,
                STATUS_CALLBACK_EVENT,
                result.payload,
                result.requestId,
                result.conversationId,
            );
        }

        if (txRow.reportOnly && txRow.status !== 'completed') {
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

        if (event === MPESA_CALLBACK_EVENTS.stk && result.reference) {
            if (provider.name !== providerName) {
                paymentLogError('callback_could_not_be_authenticated', {
                    transactionId: txRow.id,
                    provider: providerName,
                    event,
                    reference: result.reference,
                    reason: 'original provider credentials are unavailable',
                });
                return { status: 200, body: { success: true } };
            }
            try {
                const verified = await provider.getPaymentStatus(
                    result.reference,
                );
                if (verified.outcome !== result.outcome) {
                    paymentLogWarn('callback_not_confirmed_by_status_query', {
                        transactionId: txRow.id,
                        provider: providerName,
                        event,
                        reference: result.reference,
                        callbackOutcome: result.outcome,
                        queryOutcome: verified.outcome,
                        providerMessage: verified.message,
                    });
                    return { status: 200, body: { success: true } };
                }
            } catch (err) {
                paymentLogError(
                    'callback_authentication_query_failed',
                    {
                        transactionId: txRow.id,
                        provider: providerName,
                        event,
                        reference: result.reference,
                    },
                    err,
                );
                return { status: 200, body: { success: true } };
            }
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
                transactionId: result.transactionId,
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

    private async getTransaction(id: string): Promise<TransactionRow | null> {
        const [row] = await db
            .select()
            .from(transaction)
            .where(eq(transaction.id, id))
            .limit(1);
        return row ?? null;
    }

    // Finds a provider transaction by the gateway transaction number (receipt).
    // Covers both linked package payments and standalone receipt-verification
    // rows created by verifyTransactionCode.
    private async findTransactionByCode(
        providerNames: string[],
        code: string,
    ): Promise<TransactionRow | null> {
        const [row] = await db
            .select()
            .from(transaction)
            .where(
                and(
                    inArray(transaction.provider, providerNames),
                    eq(transaction.providerTransactionId, code),
                ),
            )
            .limit(1);
        return row ?? null;
    }

    private async findTransactionForCallback(
        providerName: string,
        result: ProviderCallbackResult,
        callbackNonce?: string | null,
    ): Promise<(TransactionRow & { reportOnly?: boolean }) | null> {
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

        // Verification callbacks are correlated through the status_query log
        // row written when the verification was submitted.
        if (result.conversationId) {
            const [queryLog] = await db
                .select()
                .from(transactionLog)
                .where(
                    and(
                        eq(transactionLog.provider, providerName),
                        eq(transactionLog.eventType, STATUS_QUERY_EVENT),
                        eq(
                            transactionLog.providerConversationId,
                            result.conversationId,
                        ),
                    ),
                )
                .limit(1);
            if (queryLog) {
                const row = await this.getTransaction(queryLog.transactionId);
                return row ? { ...row, reportOnly:
                    (queryLog.payload as { purpose?: string })?.purpose === 'payment_report' } : null;
            }
        }
        // The signed nonce is persisted before dispatch. It can safely bind
        // a fast report callback even before the acknowledgment/correlation
        // log arrives; reports never authorize pending transactions.
        if (callbackNonce) {
            const [row] = await db.select().from(transaction).where(and(
                eq(transaction.provider, providerName),
                eq(transaction.status, 'completed'),
                sql`${transaction.callbackNonces}->>${MPESA_CALLBACK_EVENTS.status} = ${callbackNonce}`,
                sql`exists (select 1 from ${transactionLog} where ${transactionLog.transactionId} = ${transaction.id}
                    and ${transactionLog.eventType} = ${STATUS_QUERY_EVENT}
                    and ${transactionLog.payload}->>'purpose' = 'payment_report')`,
            )).limit(1);
            if (row) return { ...row, reportOnly: true };
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
        },
    ): Promise<boolean> {
        this.lastStatusPoll.delete(txRow.id);
        let transitioned = false;
        await db.transaction(async (trx) => {
            let enriched = false;
            let receiptRejected = false;
            if (details.transactionId && outcome === 'completed') {
                const [current] = await trx.select({ receipt: transaction.providerTransactionId }).from(transaction)
                    .where(eq(transaction.id, txRow.id)).for('update');
                // No schema change: serialize receipt assignment globally,
                // including receipts shared across tenant provider names.
                await trx.execute(sql`select pg_advisory_xact_lock(hashtext(${details.transactionId}))`);
                const [used] = await trx.select({ id: transaction.id }).from(transaction)
                    .where(and(eq(transaction.providerTransactionId, details.transactionId),
                        eq(transaction.status, 'completed'))).limit(1);
                receiptRejected = Boolean((used && used.id !== txRow.id) ||
                    (current?.receipt && current.receipt !== details.transactionId));
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
                        eq(transaction.status, 'pending'),
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
                            eq(packagePayments.status, 'pending'),
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
                    .ensureActivated(packagePaymentId)
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
