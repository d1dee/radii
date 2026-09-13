// M-Pesa implementation of the PaymentProvider interface. Every piece of
// M-Pesa knowledge — Safaricom request/response shapes, result codes, phone
// number format, credential handling, callback payload parsing — is confined
// to this file (and the vendored deno-mpesa-api client it wraps). The core
// payment flow only sees the normalized types in ../types.ts.
//
// Consolidated from the legacy handlers:
//  - STK push initiation            (legacy utils/paymentMethods/mpesaExpress.ts)
//  - STK express callback handling  (legacy lib/mpesaExpressHandler.ts)
//  - transaction status callback    (legacy lib/mpesaStatusHandler.ts)
//  - receipt verification           (legacy lib/verifyTransactionHandler.ts)
// Persistence of gateway state (the legacy mpesa_status / payments tables) is
// now the core PaymentService's job via the transaction/transaction_log
// tables; this class stays stateless except for its constructor config.

import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
    PaymentProviderError,
    type InitiatePaymentResult,
    type PaymentProvider,
    type PaymentRequest,
    type PaymentStatusResult,
    type ProviderCallbackResult,
    type VerifyTransactionContext,
    type VerifyTransactionResult,
} from '../types';
import type {
    MpesaExpressCallback,
    StkPushResponse,
    StkQueryResponseInterface,
    TransactionStatusQueryCallback,
    TransactionStatusResponseInterface,
} from './deno-mpesa-api/@types/types.d';
import MpesaApi from './deno-mpesa-api/mod';

export const MPESA_PROVIDER_NAME = 'mpesa';

// Callback events this provider subscribes to. Safaricom posts to
// `${callbackBaseUrl}/stk` after an STK push and `${callbackBaseUrl}/status`
// after a transaction status query.
export const MPESA_CALLBACK_EVENTS = {
    stk: 'stk',
    status: 'status',
} as const;
export type MpesaCallbackEvent =
    (typeof MPESA_CALLBACK_EVENTS)[keyof typeof MPESA_CALLBACK_EVENTS];

const mpesaConfigSchema = z.object({
    consumerKey: z.string().min(1, 'consumerKey is required'),
    consumerSecret: z.string().min(1, 'consumerSecret is required'),
    // Organization shortcode used for API authentication and STK signing.
    shortcode: z
        .string()
        .regex(/^\d{5,7}$/, 'shortcode must be a 5-7 digit Safaricom number'),
    // Buy Goods sends the till number as PartyB; PayBill uses shortcode.
    tillNumber: z
        .string()
        .regex(/^\d{5,7}$/, 'tillNumber must be a 5-7 digit Safaricom number')
        .optional(),
    passkey: z.string().min(1, 'passkey is required'),
    environment: z
        .enum(['sandbox', 'production'], {
            message: "environment must be 'sandbox' or 'production'",
        })
        .default('sandbox'),
    // Only needed for receipt verification (Transaction Status API); STK
    // push/query work without them.
    initiatorName: z.string().min(1).optional(),
    initiatorPassword: z.string().min(1).optional(),
    // PEM or DER (.cer) certificate used to encrypt the initiator password.
    // Defaults to the Safaricom public certificate bundled with the vendored
    // deno-mpesa-api library for the selected environment.
    certificatePath: z.string().min(1).optional(),
    transactionType: z
        .enum(['CustomerPayBillOnline', 'CustomerBuyGoodsOnline'])
        .default('CustomerPayBillOnline'),
}).superRefine((config, ctx) => {
    if (
        config.transactionType === 'CustomerBuyGoodsOnline' &&
        !config.tillNumber
    ) {
        ctx.addIssue({
            code: 'custom',
            path: ['tillNumber'],
            message: 'tillNumber is required for CustomerBuyGoodsOnline',
        });
    }
});

export type MpesaProviderConfig = z.input<typeof mpesaConfigSchema>;

// The vendored client returns either an Error or a JSON body merged with
// {success, status}. Safaricom request-level failures carry errorCode/
// errorMessage instead of the normal response fields.
type MpesaResponseBody = {
    success?: boolean;
    status?: number;
    errorCode?: string;
    errorMessage?: string;
};

function isMpesaErrorBody(
    res: unknown,
): res is MpesaResponseBody & { errorCode: string; errorMessage: string } {
    return (
        typeof res === 'object' &&
        res !== null &&
        typeof (res as MpesaResponseBody).errorCode === 'string'
    );
}

// Safaricom only accepts the 254XXXXXXXXX form for M-Pesa-registered numbers.
function toMpesaPhoneNumber(phoneNumber: string): string | null {
    const digits = phoneNumber.replace(/\D/g, '');
    if (/^254\d{9}$/.test(digits)) return digits;
    if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
    if (/^[17]\d{8}$/.test(digits)) return `254${digits}`;
    return null;
}

// Result codes that mean the checkout definitively failed (no retry worth
// attempting). See https://developer.safaricom.co.ke/APIs/MpesaExpressQuery
const FINAL_STK_FAILURE_CODES = new Set([
    '1032', // Request cancelled by user
    '1037', // DS timeout (user never entered PIN)
    '2029', // Failed due to unresolved reason type
    '2002', // The Agent number and Store number entered do not match.
]);

export class MpesaPaymentProvider implements PaymentProvider {
    // Instance identity used for provider registration, transaction rows and
    // callback URL routing. The default is the server-wide "mpesa"; per-admin
    // instances are named "mpesa-<adminId>" (see ../adminProviders.ts).
    readonly name: string;

    private readonly config: z.output<typeof mpesaConfigSchema>;
    private readonly client: MpesaApi;
    private readonly defaultCertificatePath: string;

    constructor(config: MpesaProviderConfig, name = MPESA_PROVIDER_NAME) {
        this.name = name;
        const parsed = mpesaConfigSchema.safeParse(config);
        if (!parsed.success) {
            const issues = parsed.error.issues
                .map(
                    (issue) =>
                        `${issue.path.join('.') || 'config'}: ${issue.message}`,
                )
                .join('; ');
            throw new PaymentProviderError(
                `Invalid M-Pesa provider configuration — ${issues}`,
                this.name,
                { cause: parsed.error },
            );
        }
        this.config = parsed.data;

        this.defaultCertificatePath = fileURLToPath(
            new URL(
                `./deno-mpesa-api/keys/${
                    this.config.environment === 'production'
                        ? 'ProductionCertificate'
                        : 'SandboxCertificate'
                }.cer`,
                import.meta.url,
            ),
        );

        this.client = new MpesaApi(
            {
                consumerKey: this.config.consumerKey,
                consumerSecret: this.config.consumerSecret,
                certificatePath:
                    this.config.certificatePath ?? this.defaultCertificatePath,
            },
            this.config.environment,
        );
    }

    // --- PaymentProvider ----------------------------------------------------

    async initiatePayment(
        request: PaymentRequest,
    ): Promise<InitiatePaymentResult> {
        const failed = (message: string): InitiatePaymentResult => ({
            outcome: 'failed',
            reference: null,
            requestId: null,
            message,
        });

        const amount = Math.round(request.amount);
        if (!Number.isFinite(amount) || amount < 1) {
            return failed(
                `Invalid M-Pesa amount: expected at least 1 ${request.currency}, got ${request.amount}.`,
            );
        }

        const phoneNumber = toMpesaPhoneNumber(request.phoneNumber);
        if (!phoneNumber) {
            return failed(
                `"${request.phoneNumber}" is not a valid Safaricom M-Pesa phone number (expected a Kenyan number, e.g. 254712345678).`,
            );
        }

        const shortcode = Number(this.config.shortcode);
        const partyB =
            this.config.transactionType === 'CustomerBuyGoodsOnline'
                ? Number(this.config.tillNumber)
                : shortcode;
        const response = await this.client.lipaNaMpesaOnline({
            BusinessShortCode: shortcode,
            Amount: amount,
            PartyA: Number(phoneNumber),
            PartyB: partyB,
            PhoneNumber: Number(phoneNumber),
            CallBackURL: `${request.callbackBaseUrl}/${MPESA_CALLBACK_EVENTS.stk}`,
            passKey: this.config.passkey,
            AccountReference: request.accountReference.slice(0, 12),
            TransactionType: this.config.transactionType,
            TransactionDesc: request.description.slice(0, 13),
        });

        if (response instanceof Error) {
            return failed(this.mapClientError(response, 'STK push'));
        }
        if (isMpesaErrorBody(response)) {
            return failed(
                `M-Pesa rejected the STK push request: ${response.errorMessage} (code ${response.errorCode}).`,
            );
        }

        const push = response as StkPushResponse & MpesaResponseBody;
        if (!push.CheckoutRequestID || push.ResponseCode !== '0') {
            return failed(
                `STK push was not accepted by M-Pesa: ${push.ResponseDescription || 'unknown error'}.`,
            );
        }

        return {
            outcome: 'pending',
            reference: push.CheckoutRequestID,
            requestId: push.MerchantRequestID,
            // CustomerMessage is the Safaricom-approved wording for the payer.
            message:
                push.CustomerMessage ||
                'Check your phone and enter your M-Pesa PIN to complete the payment.',
        };
    }

    async getPaymentStatus(reference: string): Promise<PaymentStatusResult> {
        const pending = (message: string): PaymentStatusResult => ({
            outcome: 'pending',
            transactionId: null,
            amount: null,
            message,
        });

        const response = await this.client.lipaNaMpesaQuery({
            BusinessShortCode: this.config.shortcode,
            passKey: this.config.passkey,
            CheckoutRequestID: reference,
        });

        if (response instanceof Error) {
            return pending(this.mapClientError(response, 'STK status query'));
        }
        if (isMpesaErrorBody(response)) {
            // Includes "transaction not found" scenarios (unknown/expired
            // CheckoutRequestID): keep the payment pending but surface the
            // gateway's message so it can be logged/displayed.
            return pending(
                `M-Pesa could not check that checkout request: ${response.errorMessage} (code ${response.errorCode}).`,
            );
        }

        const query = response as StkQueryResponseInterface & MpesaResponseBody;
        if (query.ResponseCode !== '0') {
            return pending(
                `M-Pesa status query was not accepted: ${query.ResponseDescription || query.ResultDesc || 'unknown error'}.`,
            );
        }

        // STK query reports processing outcomes only; the receipt number and
        // amount are delivered exclusively via the STK callback.
        if (query.ResultCode === '0') {
            return {
                outcome: 'completed',
                transactionId: null,
                amount: null,
                message: query.ResultDesc || 'Payment completed.',
            };
        }
        if (FINAL_STK_FAILURE_CODES.has(query.ResultCode)) {
            return {
                outcome: 'failed',
                transactionId: null,
                amount: null,
                message: query.ResultDesc || 'Payment was not completed.',
            };
        }
        return pending(
            query.ResultDesc || 'Payment is still being processed by M-Pesa.',
        );
    }

    async verifyTransaction(
        transactionId: string,
        context: VerifyTransactionContext,
    ): Promise<VerifyTransactionResult> {
        const failed = (message: string): VerifyTransactionResult => ({
            outcome: 'failed',
            conversationId: null,
            message,
        });

        if (!this.config.initiatorName || !this.config.initiatorPassword) {
            return failed(
                'M-Pesa receipt verification is not configured: initiatorName and initiatorPassword are required for the Transaction Status API.',
            );
        }

        const receipt = transactionId.trim().toUpperCase();
        // Safaricom transaction IDs are alphanumeric (e.g. NEF61H8J60); reject
        // anything else locally with a clear message instead of a gateway
        // round-trip.
        if (!/^[A-Z0-9]{6,15}$/.test(receipt)) {
            return failed(
                `"${transactionId}" is not a valid M-Pesa transaction code. Check your M-Pesa message and enter the receipt number only (e.g. NEF61H8J60).`,
            );
        }
        const statusUrl = `${context.callbackBaseUrl}/${MPESA_CALLBACK_EVENTS.status}`;
        const response = await this.client.transactionStatus(
            this.config.initiatorPassword,
            {
                Initiator: this.config.initiatorName,
                TransactionID: receipt,
                PartyA: this.config.shortcode,
                IdentifierType: '4',
                ResultURL: statusUrl,
                QueueTimeOutURL: statusUrl,
                Remarks: 'Package payment verification',
            },
        );

        if (response instanceof Error) {
            return failed(
                this.mapClientError(response, 'transaction status query'),
            );
        }
        if (isMpesaErrorBody(response)) {
            return failed(
                `M-Pesa rejected the transaction status request: ${response.errorMessage} (code ${response.errorCode}).`,
            );
        }

        const status = response as TransactionStatusResponseInterface &
            MpesaResponseBody;
        if (!status.OriginatorConversationID || status.ResponseCode !== '0') {
            return failed(
                `Transaction status query was not accepted by M-Pesa: ${status.ResponseDescription || 'unknown error'}.`,
            );
        }

        // The Transaction Status API responds asynchronously: Safaricom
        // acknowledges now and POSTs the outcome to the status callback URL.
        return {
            outcome: 'pending',
            conversationId: status.OriginatorConversationID,
            message:
                'Verification request accepted by M-Pesa; waiting for the result.',
            data: {
                ResponseDescription: status.ResponseDescription,
                ConversationID: status.ConversationID,
            },
        };
    }

    async handleCallback(
        event: string,
        payload: unknown,
    ): Promise<ProviderCallbackResult> {
        switch (event) {
            case MPESA_CALLBACK_EVENTS.stk:
                return this.handleStkCallback(payload);
            case MPESA_CALLBACK_EVENTS.status:
                return this.handleStatusCallback(payload);
            default:
                throw new PaymentProviderError(
                    `Unknown M-Pesa callback event: "${event}" (expected one of: ${Object.values(MPESA_CALLBACK_EVENTS).join(', ')})`,
                    this.name,
                );
        }
    }

    // --- M-Pesa callback parsing ---------------------------------------------

    // Safaricom Mpesa Express (STK) callback:
    // { Body: { stkCallback: { MerchantRequestID, CheckoutRequestID,
    //   ResultCode, ResultDesc, CallbackMetadata? } } }
    private handleStkCallback(payload: unknown): ProviderCallbackResult {
        const stk = (payload as Partial<MpesaExpressCallback> | null)?.Body
            ?.stkCallback;
        if (!stk || typeof stk.CheckoutRequestID !== 'string') {
            throw new PaymentProviderError(
                'Malformed M-Pesa STK callback payload: missing Body.stkCallback.CheckoutRequestID.',
                this.name,
                { cause: payload },
            );
        }

        const raw = { ...(payload as Record<string, unknown>) };

        if (stk.ResultCode !== 0 || !stk.CallbackMetadata) {
            return {
                outcome: 'failed',
                reference: stk.CheckoutRequestID,
                requestId: stk.MerchantRequestID,
                conversationId: null,
                transactionId: null,
                amount: null,
                payload: raw,
                message:
                    stk.ResultDesc ||
                    `STK push failed with result code ${stk.ResultCode}.`,
            };
        }

        const metadata = Object.fromEntries(
            stk.CallbackMetadata.Item.map((item) => [item.Name, item.Value]),
        );
        const amount =
            typeof metadata.Amount === 'number'
                ? metadata.Amount
                : Number(metadata.Amount);
        const receipt =
            typeof metadata.MpesaReceiptNumber === 'string'
                ? metadata.MpesaReceiptNumber
                : null;

        return {
            outcome: 'completed',
            reference: stk.CheckoutRequestID,
            requestId: stk.MerchantRequestID,
            conversationId: null,
            transactionId: receipt,
            amount: Number.isFinite(amount) ? amount : null,
            payload: raw,
            message: stk.ResultDesc || 'Payment completed.',
        };
    }

    // Safaricom Transaction Status callback:
    // { Result: { ResultType, ResultCode, OriginatorConversationID,
    //   ConversationID, TransactionID, ResultDesc, ResultParameters? } }
    private handleStatusCallback(payload: unknown): ProviderCallbackResult {
        const result = (
            payload as Partial<TransactionStatusQueryCallback> | null
        )?.Result;
        const originatorConversationId = result?.OriginatorConversationID;
        if (!result || typeof originatorConversationId !== 'string') {
            throw new PaymentProviderError(
                'Malformed M-Pesa transaction status callback payload: missing Result.OriginatorConversationID.',
                this.name,
                { cause: payload },
            );
        }

        const raw = { ...(payload as Record<string, unknown>) };
        const resultCode =
            'ResultCode' in result ? String(result.ResultCode) : undefined;
        const resultType =
            'ResultType' in result ? String(result.ResultType) : undefined;

        const parameters: Record<string, string> = {};
        if ('ResultParameters' in result && result.ResultParameters) {
            for (const param of result.ResultParameters.ResultParameter) {
                parameters[param.Key] = param.Value;
            }
        }

        // Legacy acceptance rule: the transaction only counts as paid when it
        // is fully completed on M-Pesa's side.
        const transactionStatus = parameters.TransactionStatus ?? '';
        const completed =
            resultCode === '0' &&
            resultType === '0' &&
            transactionStatus.toLowerCase() === 'completed';

        if (!completed) {
            return {
                outcome: 'failed',
                reference: null,
                requestId: null,
                conversationId: originatorConversationId,
                transactionId:
                    'TransactionID' in result ? result.TransactionID : null,
                amount: null,
                payload: raw,
                message:
                    ('ResultDesc' in result && result.ResultDesc) ||
                    transactionStatus ||
                    'M-Pesa reported the transaction as not completed.',
            };
        }

        const amount =
            parameters.Amount !== undefined ? Number(parameters.Amount) : null;

        return {
            outcome: 'completed',
            reference: null,
            requestId: null,
            conversationId: originatorConversationId,
            // The TransactionID on a status result is the M-Pesa receipt we
            // originally asked about.
            transactionId:
                'TransactionID' in result ? result.TransactionID : null,
            amount: amount !== null && Number.isFinite(amount) ? amount : null,
            payload: raw,
            message:
                `Transaction ${parameters.ReceiptNo ?? ''} completed on M-Pesa.`.trim(),
        };
    }

    // --- Error mapping ---------------------------------------------------------

    private mapClientError(error: Error, operation: string): string {
        const message = error.message.toLowerCase();
        if (message.includes('auth')) {
            console.error(
                `M-Pesa authentication failed while attempting the ${operation}. Check the consumer key and consumer secret (${this.config.environment}).`,
            );
        }
        if (message.includes('could not be parsed')) {
            return `Could not reach M-Pesa while attempting the ${operation}. Try again in a moment.`;
        }
        return `M-Pesa ${operation} failed: ${error.message}`;
    }
}
