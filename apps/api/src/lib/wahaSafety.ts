import { z } from 'zod';

export const wahaSafetySchema = z.object({
    minDelaySeconds: z.number().int().min(30).max(3599).default(30),
    maxDelaySeconds: z.number().int().min(31).max(3600).default(60),
    batchSize: z.number().int().min(1).max(10).default(10),
    restMinutes: z.number().int().min(60).max(1440).default(60),
    perContactHourlyLimit: z.number().int().min(1).max(4).default(4),
}).strict().refine((value) => value.maxDelaySeconds > value.minDelaySeconds, {
    message: 'Maximum delay must be greater than minimum delay.',
    path: ['maxDelaySeconds'],
});

export type WahaSafetySettings = z.infer<typeof wahaSafetySchema>;
export const defaultWahaSafety = wahaSafetySchema.parse({});
