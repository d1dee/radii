import { dayjs, shortId } from '../utils.ts';

import { Package } from '../../../../types/index.d.ts';
import { getParentQuotas } from '../../database/parent_quotas.ts';
import { writeLog } from '../log.ts';

type JoinedQuotas = {
    parentTimestamp: string;
    price: number;
    downloadRate: number;
    timeRemaining: number;
    maxDevices: number;
    parentQuotaId: string;
    uploadRate: number;
    downloadQuota: number;
    uploadQuota: number;
    noExpiry: boolean;
    initialSessionLength: number;
    deviceQuotaId: string;
    deviceStaleReason: string;
    isStale: boolean;
    expiresAt: string;
};

export function calculateQuotas(userId: string, pkg?: Package) {
    if (pkg) {
        // We nee to return early when a user is buying a new package. This will ensure that the new package gets activated no matter what
        return {
            downloadRate: pkg.downloadRate,
            uploadRate: pkg.uploadRate,
            downloadQuota: pkg.downloadQuota,
            uploadQuota: pkg.uploadQuota,
            sessionLength: pkg.initialSessionLength,
            parentId: shortId(8),
            expiresAt: !pkg.noExpiry
                ? dayjs().add(pkg.initialSessionLength, 'minutes').toISOString()
                : null,
        };
    }
    // Get only packages linked to the user which aren't stale and have a session longer than 1 minute.
    let result = getParentQuotas(
        [
            'parent_quotas.timestamp AS parentTimestamp',
            'payments.Amount AS price',
            'parent_quotas.remainingSessionLength AS timeRemaining',
            'parent_quotas.initialSessionLength AS initialSessionLength',
            'parent_quotas.maxDevices',
            'parent_quotas.id AS parentQuotaId',
            'parent_quotas.downloadRate',
            'parent_quotas.uploadRate',
            'parent_quotas.downloadQuota',
            'parent_quotas.uploadQuota',
            'parent_quotas.expiresAt',
            'packages.noExpiry',
            'device_quotas.id AS deviceQuotaId',
            'device_quotas.staleReason AS deviceStaleReason',
            'device_quotas.isStale AS isStale',
        ],
        [userId, true, 1],
        [
            ['parent_quotas.userId', '='],
            'AND',
            ['parent_quotas.isStale', '!='],
            'AND',
            ['parent_quotas.remainingSessionLength', '>'],
        ],
        [
            [
                'JOIN',
                [
                    'payments',
                    [['parent_quotas.paymentId', '=', 'payments.paymentId']],
                ],
            ],
            [
                'JOIN',
                [
                    'packages',
                    [['parent_quotas.packageId', '=', 'packages.packageId']],
                ],
            ],
            [
                'LEFT JOIN',
                [
                    'device_quotas',
                    [
                        ['device_quotas.parentQuota', '=', 'parent_quotas.id'],
                        'AND',
                        ['device_quotas.isStale', '=', 'parent_quotas.isStale'],
                    ],
                ],
            ],
        ],
    ) as Array<JoinedQuotas> | Error;

    if (result instanceof Error) return result;

    // Clear expired parent quotas
    result = result.filter((v) => {
        if (typeof v.isStale === 'boolean' && v.isStale) return false; // Skip stale quotas
        if (v.timeRemaining < 1) return false; // Skip quotas with no time left
        if (v.noExpiry) return true; // No expiry means always valid

        let threshold = parseFloat(Deno.env.get('EXPIRY_THRESHOLD') || '0');
        if (threshold < 0 || threshold > 1) {
            threshold = 1; // Default to 1 if threshold is invalid
            writeLog().warn(
                `Invalid EXPIRY_THRESHOLD: ${threshold}, must be between 0 and 1`,
                new Error('Invalid EXPIRY_THRESHOLD in the env variable'),
            );
        }

        if (threshold === 0) return true; // If threshold is 0 no expiry check will be done
        if (!v.expiresAt) return false; // By now we should have expiresAt set for  this package

        // If user has more than threshold of the session remaining we consider it valid
        if (v.timeRemaining / v.initialSessionLength > threshold) return true;

        const expiryDate = dayjs(v.expiresAt);
        const now = dayjs();
        if (expiryDate.isAfter(now)) {
            writeLog().debug(
                `Quota expired: ${v.parentQuotaId} for user ${userId}`,
            );
            return true;
        }

        return false; // Keep valid quotas
    });

    // Group each package into its respective parent Id  to help know the current connected devices per package
    // We'll then compare to the expected maxDevices fort the each package and if more ignore that quota as device limit will have been reached.
    const filterMap = new Map();
    result.forEach((v) => {
        let c = filterMap.get(v.parentQuotaId) || 0;
        c = v.deviceQuotaId && !v.deviceStaleReason ? ++c : c;
        filterMap.set(v.parentQuotaId, c);
    });
    const validResults = result.filter(
        (v) => filterMap.get(v.parentQuotaId) < v.maxDevices,
    );
    // We return error if the device limit has been reached.
    if (validResults.length !== result.length && validResults.length === 0) {
        return new Error('device limit reached');
    }
    //  Sort by to make sure the longest session start as to maintain the longest session without disconnections
    const sortedResults = validResults.toSorted((a, b) => {
        // 1. Longest remaining session length
        if (a.timeRemaining !== b.timeRemaining)
            return b.timeRemaining - a.timeRemaining;
        // 2. Recently bought
        const timeA = dayjs(a.parentTimestamp).valueOf();
        const timeB = dayjs(b.parentTimestamp).valueOf();
        if (timeA !== timeB) return timeB - timeA; // Descending
        // 3. Most expensive
        if (a.price !== b.price) return b.price - a.price; // Descending
        if (a.noExpiry !== b.noExpiry) return a.noExpiry ? 1 : -1;
        return b.downloadRate - a.downloadRate; // Descending
    });

    // Find package to activate in sortedResults, considering device slots available for each
    const valid = sortedResults[0];
    if (!valid) return;

    // update the selected token to stale this will help not use it next time we'll be activating
    /*     const updateRes = updateDeviceQuotas(["isStale"], [["id", "="]], [
        true,
        valid.deviceQuotaId,
    ]); */
    // if (updateRes instanceof Error) return updateRes;

    return {
        downloadRate: valid.downloadRate,
        uploadRate: valid.uploadRate,
        downloadQuota: valid.downloadQuota,
        uploadQuota: valid.uploadQuota,
        sessionLength: valid.timeRemaining || valid.initialSessionLength,
        parentId: valid.parentQuotaId,
    };
}
