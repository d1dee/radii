// Payment provider abstraction.
//
// The core payment flow (PaymentService, routes/hotspot, routes/payments) only
// ever talks to this interface. Gateway-specific behaviour — request shapes,
// credential handling, response/callback parsing, error codes — lives entirely
// inside the concrete provider class (see mpesa/provider.ts). A new payment
// gateway is added by implementing PaymentProvider and registering the
// instance with the PaymentService; nothing else changes.

// Lifecycle of a payment as seen by the core. 'pending' means "initiated or
// unknown, keep waiting/polling", 'completed' means the money moved,
// 'failed' means the gateway rejected or aborted it.
export type PaymentOutcome = 'pending' | 'completed' | 'failed';

export type ClientPaymentFailure = 'cancelled' | 'timeout' | 'insufficient_balance';

// Only allowlisted outcomes can become a specific customer-facing message.
export function paymentFailureMessage(failure: unknown): string {
    switch (failure) {
        case 'cancelled':
            return 'You cancelled the M-Pesa payment. Please try again when ready.';
        case 'timeout':
            return 'The M-Pesa payment request timed out. Please try again.';
        case 'insufficient_balance':
            return 'Your M-Pesa balance is insufficient. Top up and try again.';
        default:
            return 'Payment could not be completed. Please try again.';
    }
}

// Normalized request to initiate a payment. Amounts are whole units of the
// currency (providers that accept fractional amounts may subdivide; M-Pesa
// only supports whole shillings).
export interface PaymentRequest {
    amount: number;
    currency: string;
    // E.164 formatted payer phone number; the provider converts it to
    // whatever format the gateway expects.
    phoneNumber: string;
    // Opaque identifier shown to the payer / used to reconcile (<= 12 chars
    // for M-Pesa STK pushes).
    accountReference: string;
    description: string;
    // Base URL of THIS service's generic provider callback route
    // (/api/payments/callback/:provider). Providers append their own
    // per-event path to it when registering webhooks with the gateway.
    callbackBaseUrl: string;
    // Random nonce the core stores on the transaction row. Providers must
    // embed it (HMAC-signed, see ./callbackToken.ts) in the ?ct= token of
    // every callback URL they register for this payment.
    callbackNonce?: string | null;
}

export interface InitiatePaymentResult {
    outcome: PaymentOutcome;
    clientFailure?: ClientPaymentFailure;
    // Gateway reference used later to poll status (e.g. M-Pesa
    // CheckoutRequestID). Null when initiation failed outright.
    reference: string | null;
    // Gateway acknowledgment id for the initiation request, if one exists
    // (e.g. M-Pesa MerchantRequestID).
    requestId: string | null;
    // Provider diagnostic message. The service logs/persists failures and
    // returns a separate stable, client-safe message from the API boundary.
    message: string;
}

export interface PaymentStatusResult {
    outcome: PaymentOutcome;
    clientFailure?: ClientPaymentFailure;
    message: string;
    // Gateway transaction/receipt number if the gateway reports it (not all
    // status queries do — M-Pesa STK query never does; only callbacks carry
    // the receipt).
    transactionId: string | null;
    amount: number | null;
}

// Context passed to verifyTransaction so providers can register async result
// URLs without knowing how this service routes its own endpoints.
export interface VerifyTransactionContext {
    callbackBaseUrl: string;
    // Random nonce persisted on the transaction or report attempt; providers embed
    // it (HMAC-signed, see ./callbackToken.ts) in the ?ct= token of the
    // async-result callback URL they register for this verification.
    callbackNonce?: string | null;
}

export interface VerifyTransactionResult {
    // 'pending' while the gateway acknowledges the verification request but
    // reports the outcome asynchronously (via callback).
    outcome: PaymentOutcome;
    clientFailure?: ClientPaymentFailure;
    // Tracking id for the asynchronous verification, used to correlate the
    // later callback (e.g. M-Pesa OriginatorConversationID).
    conversationId: string | null;
    message: string;
    // Receipt returned by a synchronous report; asynchronous reports carry
    // it in their callback instead.
    transactionId?: string | null;
    // Amount the gateway reported for the receipt, when a synchronous
    // result carries it; the core guards completed outcomes with it.
    amount?: number | null;
    // Payer phone number the gateway reported (normalized by the provider),
    // when the result exposes it; the core binds completed outcomes to the
    // payment's own phone number when both are present.
    payerPhoneNumber?: string | null;
    // Any extra gateway-reported details (status fields, descriptions...).
    data?: Record<string, unknown>;
}

// Normalized view of an inbound gateway webhook, produced by
// PaymentProvider.handleCallback. The core uses the id fields to locate the
// matching transaction row and reconcile its status.
export interface ProviderCallbackResult {
    outcome: PaymentOutcome | 'ignored';
    clientFailure?: ClientPaymentFailure;
    // Gateway reference stored at initiation time (e.g. CheckoutRequestID);
    // primary lookup key for payment callbacks.
    reference: string | null;
    // Gateway acknowledgment id stored at initiation time (e.g.
    // MerchantRequestID); fallback lookup key.
    requestId: string | null;
    // Async conversation id issued when a verification was submitted; lookup
    // key for verification callbacks.
    conversationId: string | null;
    // Gateway transaction/receipt number reported by the callback, if any.
    transactionId: string | null;
    amount: number | null;
    // Payer phone number reported by the callback (normalized by the
    // provider), when the payload exposes it; null otherwise. The core
    // refuses to complete a payment whose payer differs from the phone
    // number on the package payment.
    payerPhoneNumber: string | null;
    // Raw provider event, recorded verbatim in the transaction log.
    payload: Record<string, unknown>;
    message: string;
}

// Thrown by providers for configuration problems and unrecognised inputs.
// Its diagnostic message is server-only and must not be returned verbatim.
export class PaymentProviderError extends Error {
    constructor(
        message: string,
        public readonly provider: string,
        options?: { cause?: unknown },
    ) {
        super(message, options);
        this.name = 'PaymentProviderError';
    }
}

export interface PaymentProvider {
    // Unique id used for registration, persistence and callback routing
    // (e.g. 'mpesa'). Must be stable once data is stored against it.
    readonly name: string;

    // Initiate a payment (e.g. trigger an M-Pesa STK push). Returns a
    // normalized result; never throws for gateway-side failures.
    initiatePayment(request: PaymentRequest): Promise<InitiatePaymentResult>;

    // Confirm completion of a payment using the gateway's transaction number
    // (e.g. an M-Pesa receipt code). May be asynchronous: the provider asks
    // the gateway and reports 'pending' until the gateway calls back.
    verifyTransaction(
        transactionId: string,
        context: VerifyTransactionContext,
    ): Promise<VerifyTransactionResult>;

    // Check the status of a previously initiated payment using the reference
    // returned by initiatePayment (e.g. M-Pesa CheckoutRequestID).
    getPaymentStatus(reference: string): Promise<PaymentStatusResult>;

    // Retrieve receipt/report details after completion was confirmed by polling.
    // This is enrichment, not a second authorization of the payment.
    requestPaymentReport?(
        payment: { transactionId: string | null; requestId: string | null },
        context: VerifyTransactionContext,
    ): Promise<VerifyTransactionResult>;

    // Parse and normalize an inbound gateway webhook. Implementing this is
    // optional: providers that resolve payments purely by polling can omit
    // it, and the core rejects callbacks for such providers.
    handleCallback?(
        event: string,
        payload: unknown,
    ): Promise<ProviderCallbackResult>;
}
