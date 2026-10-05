import { z } from 'zod';
const mpesaTransactionCodeSchema = z
    .string()
    .transform((value, ctx) => {
        // Scan before uppercasing so Unicode case expansion cannot create a code.
        const candidates = new Set(
            Array.from(
                value.trim().matchAll(
                    /(?<![\p{L}\p{N}_])[0-9A-Za-z]{10}(?![\p{L}\p{N}_])/gu,
                ),
                ([code]) => code.toUpperCase(),
            ).filter((code) => /[A-Z]/.test(code) && /[0-9]/.test(code)),
        );
        if (candidates.size !== 1) {
            ctx.addIssue({
                code: 'custom',
                message:
                    candidates.size > 1
                        ? 'Multiple M-Pesa transaction codes found; enter only one receipt'
                        : 'Could not find a valid M-Pesa transaction code',
            });
            return z.NEVER;
        }
        return candidates.values().next().value!;
    })
    .pipe(
        z.string().regex(/^[0-9A-Z]{10}$/, 'Could not find transaction code'),
    );

export const paymentTransactionCodeSchema = z.object({
    transactionCode: mpesaTransactionCodeSchema,
});

export type PaymentClaimOutcome =
    | 'activated'
    | 'already_activated'
    | 'activation_pending';

export type PaymentClaimActivationDetails = {
    activationId: string;
    packageTitle: string;
    nasDeviceName: string;
    activatedAt: string;
    expireAt: string | null;
    noExpiry: boolean;
    sessionLength: number;
    active: boolean;
};

export type PaymentReceiptClaimResult<TActivation> = {
    paymentId: string | null;
    status: 'pending' | 'paid' | 'failed';
    message: string;
    claimOutcome?: PaymentClaimOutcome;
    activationDetails?: PaymentClaimActivationDetails | null;
    activation?: TActivation | null;
};
