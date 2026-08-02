import type { Package } from '@radii/shared';

// Static package catalog grouped by category. This stands in for the packages
// table until the hotspot-domain schema (packages/gateways/quotas/payments) is
// ported to drizzle. The shape matches what the SPA consumes.
export const PACKAGES: Array<[string, Package[]]> = [
    [
        'daily',
        [
            {
                packageId: 'pkg-daily-1',
                title: 'Daily Basic',
                category: 'daily',
                initialSessionLength: 60,
                price: 10,
                maxDevices: 1,
                noExpiry: false,
                description: '1 hour internet access',
                uploadRate: 1024,
                downloadRate: 2048,
                downloadQuota: 100 * 1024,
                uploadQuota: 50 * 1024,
            },
            {
                packageId: 'pkg-daily-2',
                title: 'Daily Plus',
                category: 'daily',
                initialSessionLength: 180,
                price: 25,
                maxDevices: 2,
                noExpiry: false,
                description: '3 hours internet access',
                uploadRate: 2048,
                downloadRate: 4096,
                downloadQuota: 300 * 1024,
                uploadQuota: 150 * 1024,
            },
        ],
    ],
    [
        'weekly',
        [
            {
                packageId: 'pkg-weekly-1',
                title: 'Weekly Standard',
                category: 'weekly',
                initialSessionLength: 10080,
                price: 100,
                maxDevices: 3,
                noExpiry: false,
                description: '7 days internet access',
                uploadRate: 2048,
                downloadRate: 4096,
                downloadQuota: 2000 * 1024,
                uploadQuota: 1000 * 1024,
            },
        ],
    ],
];
