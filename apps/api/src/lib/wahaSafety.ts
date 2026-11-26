import { z } from 'zod';

export const wahaSafetySchema = z.preprocess((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    // Existing settings and already-open admin forms may still contain break fields.
    const { batchSize: _batch, restMinutes: _rest, ...settings } = value as Record<string, unknown>;
    return settings;
}, z.object({
    minDelaySeconds: z.number().int().min(30).max(3599).default(30),
    maxDelaySeconds: z.number().int().min(31).max(3600).default(60),
    perContactHourlyLimit: z.number().int().min(1).max(4).default(4),
}).strict().refine((value) => value.maxDelaySeconds > value.minDelaySeconds, {
    message: 'Maximum delay must be greater than minimum delay.',
    path: ['maxDelaySeconds'],
}));

export type WahaSafetySettings = z.infer<typeof wahaSafetySchema>;
export const defaultWahaSafety = wahaSafetySchema.parse({});
