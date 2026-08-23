import { z } from 'zod';
export const mpesaTransactionCodeSchema = z.object({
    transactionCode: z
        .string()
        .transform((v) => v.substring(0, 10))
        .pipe(
            z
                .string()
                .regex(/^[0-9A-Z]{10}$/i, 'Could not find Transaction code'),
        ),
});
