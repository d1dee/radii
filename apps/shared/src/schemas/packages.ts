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
        price: z
            .number()
            .int('M-Pesa package prices must be whole shillings')
            .nonnegative('Price must be non-negative'),
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
        fairUsageLimit: z
            .number()
            .int('Must be an integer')
            .min(0, 'Must be non-negative'),
        fairUsageWindowValue: z
            .number()
            .int('Must be an integer')
            .positive('Must be positive'),
        fairUsageWindowUnit: z.enum(['session', 'days', 'weeks', 'months']),
        fairUsageUploadRate: z
            .number()
            .int('Must be an integer')
            .min(0, 'Must be non-negative'),
        fairUsageDownloadRate: z
            .number()
            .int('Must be an integer')
            .min(0, 'Must be non-negative'),
        burstUploadRate: z
            .number()
            .int('Must be an integer')
            .min(0, 'Must be non-negative'),
        burstDownloadRate: z
            .number()
            .int('Must be an integer')
            .min(0, 'Must be non-negative'),
        burstUploadThreshold: z
            .number()
            .int('Must be an integer')
            .min(0, 'Must be non-negative'),
        burstDownloadThreshold: z
            .number()
            .int('Must be an integer')
            .min(0, 'Must be non-negative'),
        burstTime: z
            .number()
            .int('Must be an integer')
            .min(0, 'Must be non-negative'),
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

        const hasBurstValues =
            pkg.burstUploadRate > 0 ||
            pkg.burstDownloadRate > 0 ||
            pkg.burstUploadThreshold > 0 ||
            pkg.burstDownloadThreshold > 0;
        const hasBurstRate =
            pkg.burstUploadRate > 0 || pkg.burstDownloadRate > 0;
        if (hasBurstValues && pkg.burstTime === 0) {
            ctx.addIssue({
                code: 'custom',
                path: ['burstTime'],
                message: 'Burst period is required when burst limits are set',
            });
        }
        if (pkg.burstTime > 0 && !hasBurstRate) {
            ctx.addIssue({
                code: 'custom',
                path: ['burstTime'],
                message: 'Set at least one burst rate',
            });
        }

        const validateBurstDirection = (
            direction: 'Upload' | 'Download',
            baseRate: number,
            burstRate: number,
            threshold: number,
            ratePath: 'burstUploadRate' | 'burstDownloadRate',
            thresholdPath:
                | 'burstUploadThreshold'
                | 'burstDownloadThreshold',
        ) => {
            if (burstRate > 0 && baseRate === 0) {
                ctx.addIssue({
                    code: 'custom',
                    path: [ratePath],
                    message: `${direction} burst cannot be used with an unlimited base rate`,
                });
            } else if (burstRate > 0 && burstRate <= baseRate) {
                ctx.addIssue({
                    code: 'custom',
                    path: [ratePath],
                    message: `${direction} burst rate must exceed the base rate`,
                });
            }
            if (threshold > 0 && (burstRate === 0 || threshold >= burstRate)) {
                ctx.addIssue({
                    code: 'custom',
                    path: [thresholdPath],
                    message: `${direction} burst threshold must be below its burst rate`,
                });
            }
        };
        validateBurstDirection(
            'Upload',
            pkg.uploadRate,
            pkg.burstUploadRate,
            pkg.burstUploadThreshold,
            'burstUploadRate',
            'burstUploadThreshold',
        );
        validateBurstDirection(
            'Download',
            pkg.downloadRate,
            pkg.burstDownloadRate,
            pkg.burstDownloadThreshold,
            'burstDownloadRate',
            'burstDownloadThreshold',
        );

        if (
            pkg.fairUsageLimit > 0 &&
            pkg.fairUsageUploadRate === 0 &&
            pkg.fairUsageDownloadRate === 0
        ) {
            ctx.addIssue({
                code: 'custom',
                path: ['fairUsageLimit'],
                message: 'Set at least one throttled rate for fair usage',
            });
        }
        if (
            pkg.fairUsageLimit > 0 &&
            pkg.uploadRate > 0 &&
            (pkg.fairUsageUploadRate === 0 ||
                pkg.fairUsageUploadRate > pkg.uploadRate)
        ) {
            ctx.addIssue({
                code: 'custom',
                path: ['fairUsageUploadRate'],
                message: 'Throttled upload rate must be between 1 and the base rate',
            });
        }
        if (
            pkg.fairUsageLimit > 0 &&
            pkg.downloadRate > 0 &&
            (pkg.fairUsageDownloadRate === 0 ||
                pkg.fairUsageDownloadRate > pkg.downloadRate)
        ) {
            ctx.addIssue({
                code: 'custom',
                path: ['fairUsageDownloadRate'],
                message: 'Throttled download rate must be between 1 and the base rate',
            });
        }
    });
