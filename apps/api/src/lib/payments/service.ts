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
import { paymentLogError, paymentLogInfo, paymentLogWarn } from './log';
import {
    MPESA_CALLBACK_EVENTS,
    MPESA_PROVIDER_NAME,
} from './mpesa/provider';
import {
    PaymentProviderError,
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
    'We could not start the payment. Please check the phone number and try again.';
const PAYMENT_VERIFICATION_FAILED_MESSAGE =
    'We could not verify that receipt right now. Please try again in a moment.';

export class PaymentService {
    private providers = new Map<string, PaymentProvider>();
    private defaultProviderName: string | null = null;
    // Last time we polled the gateway for a transaction's status (by
    // transaction id). In-memory only: a restart just costs one immediate
    // poll, which is fine.
    private lastStatusPoll = new Map<string, number>();

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
                requestId: result.requestId,
            });
            return {
                success: false,
                message: PAYMENT_START_FAILED_MESSAGE,
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

        return { success: true, message: result.message };
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
            return transitioned
                ? 'paid'
                : await this.getPackagePaymentStatus(payment.id, payment.status);
        }
        if (result.outcome === 'failed') {
            const transitioned = await this.applyOutcome(txRow, 'failed', {
                source: 'status_poll',
                message: result.message,
            });
            return transitioned
                ? 'failed'
                : await this.getPackagePaymentStatus(payment.id, payment.status);
        }
        return payment.status;
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
        let result;
        try {
            result = await provider.verifyTransaction(code, {
                callbackBaseUrl: this.callbackBaseUrl(provider.name),
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
                message: PAYMENT_VERIFICATION_FAILED_MESSAGE,
                error: true,
            };
        }

        if (result.outcome === 'completed') {
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
            message:
                result.message ||
                'Waiting for the provider to confirm this transaction...',
        };
    }

    // Dispatches an inbound webhook to the owning provider and reconciles the
    // referenced transaction. Returns the HTTP response for the gateway.
    async handleProviderCallback(
        providerName: string,
        event: string,
        payload: unknown,
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
            await this.appendLog(
                txRow.id,
                txRow.provider,
                STATUS_CALLBACK_EVENT,
                result.payload,
                result.requestId,
                result.conversationId,
            );
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
            const mismatch =
                event === MPESA_CALLBACK_EVENTS.status
                    ? await this.amountMismatch(txRow, result.amount)
                    : null;
            if (mismatch) {
                await this.applyOutcome(txRow, 'failed', {
                    transactionId: result.transactionId,
                    source: `callback_${event}`,
                    message: mismatch,
                    amount: result.amount,
                    payload: { ...result.payload, message: mismatch },
                    requestId: result.requestId,
                    conversationId: result.conversationId,
                });
                return { status: 200, body: { success: true } };
            }
            await this.applyOutcome(txRow, 'completed', {
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
    ): Promise<TransactionRow | null> {
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
            if (queryLog)
                return await this.getTransaction(queryLog.transactionId);
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

    // Flips the transaction (and any linked package payment) to a final state
    // and records the provider event. Webhook outcomes are authoritative and
    // overwrite earlier poll-based results. A completed package purchase also
    // triggers RADIUS activation here (fire-and-forget: the payment is already
    // settled, and GET /payment/:id re-asserts activation idempotently).
    private async applyOutcome(
        txRow: TransactionRow,
        outcome: Exclude<PaymentOutcome, 'pending'>,
        details: {
            transactionId?: string | null;
            source: string;
            message: string;
            // Amount reported by the gateway; recorded on the transaction
            // (receipt-verification rows carry a 0 placeholder until now).
            amount?: number | null;
            payload?: Record<string, unknown>;
            requestId?: string | null;
            conversationId?: string | null;
        },
    ): Promise<boolean> {
        this.lastStatusPoll.delete(txRow.id);
        let transitioned = false;
        await db.transaction(async (trx) => {
            const updated = await trx
                .update(transaction)
                .set({
                    status: outcome,
                    ...(details.transactionId
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
                    : `payment_outcome_ignored_${details.source}`,
                payload: transitioned
                    ? (details.payload ?? { message: details.message })
                    : {
                          requestedOutcome: outcome,
                          message: details.message,
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
