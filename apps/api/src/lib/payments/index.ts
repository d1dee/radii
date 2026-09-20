// Payment subsystem composition root: builds the PaymentService, registers
// every provider whose configuration is present, and exports the singleton
// used by routes. Adding a future gateway = build its provider here and
// register() it; nothing else in the app changes.

import { env } from '../../env';
import { apiLogger } from '../../logging';
import { MpesaPaymentProvider } from './mpesa/provider';
import { PaymentService } from './service';

const logger = apiLogger.getChild('payments');

function buildPaymentService(): PaymentService {
    const service = new PaymentService();

    const { mpesa } = env;
    // Any M-Pesa variable present means the operator intends to enable it:
    // register strictly, which throws a clear error on incomplete/invalid
    // credentials at startup. With nothing set, payments are disabled and the
    // service reports that to callers.
    if (
        mpesa.consumerKey ||
        mpesa.consumerSecret ||
        mpesa.shortcode ||
        mpesa.tillNumber ||
        mpesa.passkey
    ) {
        service.register(
            new MpesaPaymentProvider({
                consumerKey: mpesa.consumerKey,
                consumerSecret: mpesa.consumerSecret,
                shortcode: mpesa.shortcode,
                tillNumber: mpesa.tillNumber || undefined,
                passkey: mpesa.passkey,
                environment: mpesa.environment,
                initiatorName: mpesa.initiatorName || undefined,
                initiatorPassword: mpesa.initiatorPassword || undefined,
                certificatePath: mpesa.certificatePath || undefined,
                transactionType: mpesa.transactionType,
            }),
        );
    } else {
        logger.warn(
            'M-Pesa payment initiation is disabled; provider is not configured',
        );
    }

    return service;
}

// Guarded against `bun --hot` re-evaluation stacking duplicate singletons
// (same pattern as db/index.ts).
const globalRef = globalThis as unknown as {
    __paymentService?: PaymentService;
};

export const paymentService: PaymentService = globalRef.__paymentService
    ? globalRef.__paymentService
    : buildPaymentService();

export { PaymentService } from './service';
export type { PackagePaymentRow } from './service';
export { PaymentProviderError } from './types';
export type {
    InitiatePaymentResult,
    PaymentOutcome,
    PaymentProvider,
    PaymentRequest,
    PaymentStatusResult,
    ProviderCallbackResult,
    VerifyTransactionContext,
    VerifyTransactionResult,
} from './types';
