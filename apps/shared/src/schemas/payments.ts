import { z } from 'zod';
const mpesaTransactionCodeSchema = z
    .string()
    .transform((v) => v.substring(0, 10))
    .pipe(
        z.string().regex(/^[0-9A-Z]{10}$/i, 'Could not find Transaction code'),
    );

export const paymentTransactionCodeSchema = z.object({
    transactionCode: mpesaTransactionCodeSchema,
});
