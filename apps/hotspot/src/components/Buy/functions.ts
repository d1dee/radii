import { z } from 'zod';
import { parseServiceProvider } from '@radii/shared';

const zPhoneNumber = z
    .string()
    .min(1, 'Phone number is required')
    .transform((v) => {
        const provider = parseServiceProvider(v);
        return provider instanceof Error ? v : provider.phoneNumber;
    });

export function zValidate(data: unknown) {
    return z
        .object({
            phoneNumber: zPhoneNumber,
            packageId: z.string().max(32).min(8),
        })
        .superRefine((v, ctx) => {
            const provider = parseServiceProvider(v.phoneNumber);
            if (provider instanceof Error || provider.name !== 'safaricom') {
                ctx.addIssue({
                    path: ['phoneNumber'],
                    code: z.ZodIssueCode.custom,
                    message: 'Only M-Pesa payment is supported at the moment.',
                });
            }
        })
        .safeParse(data);
}

export function validateForm(data: unknown) {
    const results = zValidate(data);
    if (!results.success) {
        return new Error(
            results.error.flatten().fieldErrors?.phoneNumber?.shift() || '',
        );
    }
    return { ...results.data, method: 'order' };
}

export const buyFormSchema = z.object({
    phoneNumber: z
        .string()
        .min(1, 'Phone number is required')
        .refine(
            (v) => {
                const provider = parseServiceProvider(v);
                return (
                    !(provider instanceof Error) &&
                    provider.name === 'safaricom'
                );
            },
            { message: 'Only M-Pesa payment is supported at the moment.' },
        ),
});
