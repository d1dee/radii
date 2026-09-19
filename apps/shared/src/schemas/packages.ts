import { z } from 'zod';
export const createPackageSchema = z
    .object({
        title: z.string().min(1, 'Title is required'),
        type: z.enum(['hotspot', 'pppoe']),
        category: z.string().min(1, 'Category is required'),
        sessionLength: z
            .number()
            .int('Must be an integer')
            .positive('Must be positive'),
        price: z.number().min(0, 'Must be non-negative'),
        maxDevices: z
            .number()
            .int('Must be an integer')
            .positive('Must be positive'),
        noExpiry: z.boolean(),
        description: z.string().optional(),
        note: z.string().optional(),
        uploadRate: z.number().min(0, 'Must be non-negative'),
        downloadRate: z.number().min(0, 'Must be non-negative'),
        downloadQuota: z.number().min(0, 'Must be non-negative'),
        uploadQuota: z.number().min(0, 'Must be non-negative'),
        nasDeviceIds: z
            .array(z.uuid())
            .min(1, 'Link the package to at least one NAS device'),
    })
    .superRefine((pkg, ctx) => {
        // PPPoE activations are always calendar-based; the cumulative time-bank
        // (noExpiry) model only applies to hotspot packages.
        if (pkg.type === 'pppoe' && pkg.noExpiry) {
            ctx.addIssue({
                code: 'custom',
                path: ['noExpiry'],
                message: 'PPPoE packages cannot use No Expiry',
            });
        }
    });
