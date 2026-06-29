import {
    insertParentQuotas,
    updateParentQuotas,
} from '../../database/parent_quotas.ts';

import { Package } from '../../../../types/index.d.ts';
import { updateAuths } from '../../database/auths.ts';
import { insertDeviceQuotas } from '../../database/device_quotas.ts';
import database from '../../database/index.ts';
import { writeLog } from '../log.ts';
import { shortId } from '../utils.ts';
import { calculateQuotas } from './calculate.ts';

/* packageId  and dbPackage are required when activating a package.  */
export function activateQuota(
    userId: string,
    gatewayHash: string,
    rHid: string,
    hid: string,
    paymentId?: string,
    pkg?: Package,
) {
    // Get quotas for the selected package
    writeLog().debug('Activating package');

    const q = calculateQuotas(userId, pkg);

    if (q instanceof Error) {
        writeLog().debug(q.message);
        return q;
    }

    // Return undefined to indicate no valid quotas were found
    if (!q || Object.values(q).includes(0)) return undefined;

    const {
        downloadQuota,
        downloadRate,
        uploadQuota,
        uploadRate,
        sessionLength,
        parentId,
        expiresAt,
    } = q;

    // Insert device_quota and set auth as pending
    const deviceQuotaId = shortId(8);

    // Generate activation string
    const quotaString = [
        rHid,
        sessionLength,
        uploadRate,
        downloadRate,
        uploadQuota,
        downloadQuota,
        btoa(deviceQuotaId),
        '\n',
    ].join(' ');

    writeLog().debug(`Quota string: ${quotaString}`);

    const transaction = database.transaction(() => {
        let res = undefined;
        if (paymentId && pkg) {
            // Create a new parent_quota entry
            res = insertParentQuotas(
                [
                    'id',
                    'userId',
                    'isStale',
                    'expiresAt',
                    'packageId',
                    'initialSessionLength',
                    'remainingSessionLength',
                    'uploadRate' /* Kbps */,
                    'downloadRate' /* Kbps */,
                    'uploadQuota' /* KB */,
                    'downloadQuota' /* KB */,
                    'maxDevices',
                    'paymentId',
                ],
                [
                    parentId,
                    userId,
                    false,
                    expiresAt,
                    pkg.packageId,
                    sessionLength,
                    sessionLength,
                    uploadRate,
                    downloadRate,
                    uploadQuota,
                    downloadQuota,
                    pkg.maxDevices,
                    paymentId,
                ],
                { upsert: [['id']] },
            );
        } else {
            res = updateParentQuotas(
                ['remainingSessionLength'],
                [['id', '=']],
                [sessionLength, parentId],
            );
        }

        //  Insert device quotas
        res = insertDeviceQuotas(
            [
                'id',
                'isStale',
                'rHid',
                'customPayload',
                'quotaString',
                'hid',
                'parentQuota',
            ],
            [
                deviceQuotaId,
                false,
                rHid,
                btoa(deviceQuotaId),
                quotaString,
                hid,
                parentId,
            ],
            { upsert: [['rHid']] },
        );

        if (res instanceof Error) return res;

        res = updateAuths(
            ['deviceQuota', 'gatewayHash', 'pending'],
            [['hid', '=']],
            [rHid, gatewayHash, true, hid],
        );
        return res;
    });

    const transactionRes = transaction();
    if (transactionRes instanceof Error) return transactionRes;

    return parentId;
}
