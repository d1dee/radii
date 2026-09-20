import { z } from 'zod';
const mpesaTransactionCodeSchema = z
    .string()
    .transform((value, ctx) => {
        const input = value.trim().toUpperCase();
        const direct = input.match(/^[0-9A-Z]{10}$/)?.[0];
        const fromMessage = input.match(/\b[0-9A-Z]{10}\b/)?.[0];
        const code = direct ?? fromMessage;
        if (!code) {
            ctx.addIssue({
                code: 'custom',
                message: 'Could not find a valid M-Pesa transaction code',
            });
            return z.NEVER;
        }
        return code;
    })
    .pipe(
        z.string().regex(/^[0-9A-Z]{10}$/, 'Could not find transaction code'),
    );

export const paymentTransactionCodeSchema = z.object({
    transactionCode: mpesaTransactionCodeSchema,
});
