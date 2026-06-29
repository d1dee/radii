import { Payment, updatePayments } from '../../database/payments.ts';

import { Package } from '../../../../types/index.d.ts';
import { writeLog } from '../log.ts';
import { activateQuota } from './activate.ts';

type QuotaParams = {
    userId: string;
    gatewayHash: string;
    rHid: string;
    hid: string;
};
export function completePendingActivation(
    payment: Payment & Package,
    quotaParams: QuotaParams,
) {
    try {
        // Complete payment processing

        const pkg = Object.fromEntries(
            (
                [
                    'packageId',
                    'gateway',
                    'maxDevices',
                    'noExpiry',
                    'uploadRate',
                    'downloadQuota',
                    'downloadRate',
                    'initialSessionLength',
                    'uploadQuota',
                    'title',
                    'price',
                    'description',
                    'category',
                ] as Array<keyof typeof payment>
            ).map((key) => [key, payment[key]]),
        ) as Package;

        const parentQuotaId = activateQuota(
            quotaParams.userId,
            quotaParams.gatewayHash,
            quotaParams.rHid,
            quotaParams.hid,
            payment.paymentId,
            pkg,
        );

        if (parentQuotaId instanceof Error) {
            writeLog().error(
                'Error while activating quota for user ' + quotaParams.userId,
                parentQuotaId,
            );
            return parentQuotaId;
        } else {
            // Update payment with the parent quota id
            writeLog().debug(
                `Payment ${payment.paymentId} updated with quota id ${parentQuotaId}.`,
            );

            const res = updatePayments(
                ['quotaId'],
                [['paymentId', '=']],
                [parentQuotaId, payment.paymentId],
            );
            if (res instanceof Error) return res;
            else return parentQuotaId;
        }
    } catch (err) {
        writeLog().error('Error complete pending activation', err as Error);
        return err as Error;
    }
}
