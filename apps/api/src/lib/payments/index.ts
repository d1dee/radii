// Payment subsystem composition root: builds the PaymentService, registers
// every provider whose configuration is present, and exports the singleton
// used by routes. Adding a future gateway = build its provider here and
// register() it; nothing else in the app changes.

import { env } from '../../env';
import { MpesaPaymentProvider } from './mpesa/provider';
import { PaymentService } from './service';

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
        mpesa.passkey
    ) {
        service.register(
            new MpesaPaymentProvider({
                consumerKey: mpesa.consumerKey,
                consumerSecret: mpesa.consumerSecret,
                shortcode: mpesa.shortcode,
                passkey: mpesa.passkey,
                environment: mpesa.environment,
                initiatorName: mpesa.initiatorName || undefined,
                initiatorPassword: mpesa.initiatorPassword || undefined,
                certificatePath: mpesa.certificatePath || undefined,
            }),
        );
    } else {
        console.warn(
            '[payments] No M-Pesa credentials configured (MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_SHORTCODE, MPESA_PASSKEY); payment initiation is disabled.',
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
