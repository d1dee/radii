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
import { packagePayments, transaction, transactionLog } from '../../db/schema';
import { env } from '../../env';
import { getAdminIdForNasDevice, getAdminIdForUser } from '../adminSettings';
import { getPaymentByTransactionCode, type PackageRow } from '../packages';
import { radiusClient, type ActivationRedirect } from '../radius';
import {
    getAdminMpesaProvider,
    parseAdminIdFromProviderName,
    resolveProviderByName,
} from './adminProviders';
import { MPESA_PROVIDER_NAME } from './mpesa/provider';
import {
    PaymentProviderError,
    type PaymentOutcome,
    type PaymentProvider,
    type ProviderCallbackResult,
} from './types';

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
    // Present once the verified payment has its package activated on RADIUS;
    // the portal uses it for the final redirect to the NAS.
    activation?: ActivationRedirect | null;
}

const STATUS_QUERY_EVENT = 'status_query';
const STATUS_CALLBACK_EVENT = 'status_callback';
// Providers that deliver callbacks resolve payments on their own, so the
// fallback poll-by-reference only needs to run every this often.
const STATUS_POLL_INTERVAL_MS = 15_000;

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
        // Tenant attribution: payment -> NAS device -> owning admin. When the
        // owner stored their own M-Pesa credentials the payment runs through
        // their till; otherwise the server-wide provider is used.
        let provider: PaymentProvider | null;
        try {
            const adminId = await getAdminIdForNasDevice(payment.nasDeviceId);
            provider = await this.providerForAdmin(adminId);
        } catch (err) {
            if (err instanceof PaymentProviderError) {
                return { success: false, message: err.message };
            }
            throw err;
        }
        if (!provider) {
            return {
                success: false,
                message: 'No payment provider is configured on this server.',
            };
        }

        const [txRow] = await db
            .insert(transaction)
            .values({
                userId: payment.userId,
                type: 'income',
                amount: String(payment.amount),
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

        const result = await provider.initiatePayment({
            amount: Number(pkg.price),
            currency: 'KES',
            phoneNumber: payment.phoneNumber,
            accountReference: payment.id.replace(/-/g, '').slice(0, 12),
            description: pkg.title,
            callbackBaseUrl: this.callbackBaseUrl(provider.name),
        });

        if (result.outcome !== 'pending' || !result.reference) {
            await db
                .update(transaction)
                .set({ status: 'failed' })
                .where(eq(transaction.id, txRow.id));
            await this.appendLog(
                txRow.id,
                provider.name,
                'payment_initiation_failed',
                { message: result.message },
                result.requestId,
            );
            return {
                success: false,
                message:
                    result.message ||
                    'The payment provider rejected the payment request.',
            };
        }

        await db
            .update(transaction)
            .set({ providerReference: result.reference })
            .where(eq(transaction.id, txRow.id));
        await this.linkPaymentToTransaction(payment, txRow.id);
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

        const result = await provider.getPaymentStatus(txRow.providerReference);
        if (result.outcome === 'completed') {
            await this.applyOutcome(txRow, 'completed', {
                transactionId: result.transactionId,
                source: 'status_poll',
                message: result.message,
            });
            return 'paid';
        }
        if (result.outcome === 'failed') {
            await this.applyOutcome(txRow, 'failed', {
                source: 'status_poll',
                message: result.message,
            });
            return 'failed';
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
    ): Promise<VerifyByCodeOutcome | null> {
        const code = rawCode.trim().toUpperCase();

        // Attribute the verification to the tenant admin the customer last
        // paid (their M-Pesa till issued the receipt); fall back to the
        // server-wide provider when no attribution exists.
        let provider: PaymentProvider | null;
        try {
            const adminId = await getAdminIdForUser(userId);
            provider = await this.providerForAdmin(adminId);
        } catch (err) {
            if (err instanceof PaymentProviderError) {
                return {
                    status: 'pending',
                    paymentId: null,
                    message: err.message,
                    error: true,
                };
            }
            throw err;
        }
        if (!provider) {
            return {
                status: 'pending',
                paymentId: null,
                message: 'No payment provider is configured on this server.',
                error: true,
            };
        }

        // 1. A package payment already carries this receipt.
        const payment = await getPaymentByTransactionCode(code);
        if (payment) {
            if (payment.userId !== userId) return null;
            // Paid but never activated (e.g. callback arrived before the
            // client polled): activate now — idempotent.
            const activation =
                payment.status === 'paid'
                    ? await radiusClient
                          .ensureActivated(payment.id)
                          .catch((err) => {
                              console.error(
                                  `[radius] activation for payment ${payment.id} failed:`,
                                  err,
                              );
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
            if (known.status === 'completed') {
                return {
                    paymentId: known.id,
                    status: 'paid',
                    message: `Payment confirmed by the provider (receipt ${code}).`,
                };
            }
            if (known.status === 'failed') {
                return {
                    paymentId: known.id,
                    status: 'failed',
                    message:
                        'The provider reported this transaction as not completed. Contact the admin if money left your account.',
                };
            }
            return {
                paymentId: known.id,
                status: 'pending',
                message:
                    'Waiting for the provider to confirm this transaction...',
            };
        }

        // 3. An in-flight verification whose row we could not match above
        // (e.g. callback still in transit): keep the client polling.
        const [pendingQuery] = await db
            .select()
            .from(transactionLog)
            .where(
                and(
                    inArray(transactionLog.provider, family),
                    eq(transactionLog.eventType, STATUS_QUERY_EVENT),
                    sql`${transactionLog.payload}->>'receipt' = ${code}`,
                ),
            )
            .orderBy(desc(transactionLog.createdAt))
            .limit(1);
        if (pendingQuery?.providerConversationId) {
            const [callback] = await db
                .select({ id: transactionLog.id })
                .from(transactionLog)
                .where(
                    and(
                        inArray(transactionLog.provider, family),
                        eq(transactionLog.eventType, STATUS_CALLBACK_EVENT),
                        eq(
                            transactionLog.providerConversationId,
                            pendingQuery.providerConversationId,
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

        // 4. Submit a fresh verification to the provider.
        const result = await provider.verifyTransaction(code, {
            callbackBaseUrl: this.callbackBaseUrl(provider.name),
        });

        if (result.outcome === 'failed') {
            return {
                status: 'pending',
                paymentId: null,
                message: result.message,
                error: true,
            };
        }

        // Target row for the asynchronous status callback. The amount is only
        // learned once the provider reports it (placeholder 0 until then).
        const [verTx] = await db
            .insert(transaction)
            .values({
                userId,
                type: 'income',
                amount: '0',
                provider: provider.name,
                status: 'pending',
                description: `Receipt verification: ${code}`,
                metadata: { receipt: code },
            })
            .returning();

        if (result.outcome === 'completed') {
            await this.applyOutcome(verTx, 'completed', {
                transactionId: code,
                source: 'receipt_verification',
                message: result.message,
            });
            return {
                paymentId: verTx.id,
                status: 'paid',
                message: 'Payment verified.',
            };
        }

        if (result.conversationId) {
            await this.appendLog(
                verTx.id,
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
            paymentId: verTx.id,
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
                return {
                    status: 400,
                    body: { success: false, message: err.message },
                };
            }
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
            console.warn(
                `[payments] callback ${providerName}/${event} matched no transaction; payload logged to console only`,
            );
            return { status: 200, body: { success: true } };
        }

        if (result.outcome === 'completed') {
            const mismatch = await this.amountMismatch(txRow, result.amount);
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
    ): Promise<void> {
        this.lastStatusPoll.delete(txRow.id);
        await db.transaction(async (trx) => {
            await trx
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
                .where(eq(transaction.id, txRow.id));

            await trx
                .update(packagePayments)
                .set({ status: outcome === 'completed' ? 'paid' : 'failed' })
                .where(eq(packagePayments.transaction, txRow.id));

            await trx.insert(transactionLog).values({
                transactionId: txRow.id,
                provider: txRow.provider,
                eventType:
                    outcome === 'completed'
                        ? `payment_completed_${details.source}`
                        : `payment_failed_${details.source}`,
                payload: details.payload ?? { message: details.message },
                providerRequestId: details.requestId ?? null,
                providerConversationId: details.conversationId ?? null,
            });
        });

        if (outcome === 'completed') {
            const packagePaymentId = (
                txRow.metadata as { packagePaymentId?: string } | null
            )?.packagePaymentId;
            if (packagePaymentId) {
                void radiusClient
                    .ensureActivated(packagePaymentId)
                    .catch((err) =>
                        console.error(
                            `[radius] activation for payment ${packagePaymentId} failed:`,
                            err,
                        ),
                    );
            }
        }
    }

    private async linkPaymentToTransaction(
        payment: PackagePaymentRow,
        transactionId: string,
    ): Promise<void> {
        await db
            .update(packagePayments)
            .set({ transaction: transactionId })
            .where(eq(packagePayments.id, payment.id));
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
