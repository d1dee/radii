import {
    getDeviceQuotas,
    updateDeviceQuotas,
} from '../../database/device_quotas.ts';

import { updateAuths } from '../../database/auths.ts';
import database from '../../database/index.ts';
import { getNdsStatus } from '../../database/ndsctl_status.ts';
import { writeLog } from '../log.ts';

type Quota = Array<{
    last_active: string;
    session_start: string;
    session_end: string;
    state: string;
    gatewayMac: string;
    mac: string;
    rHid: string;
}>;
export function deauthDeviceQuota(deviceQuotaId: string) {
    if (deviceQuotaId.length !== 8) {
        const error = new Error('Invalid device quota');
        writeLog().warn('Recieved an invalid device quota', error);
        return error;
    }

    const quotas = getDeviceQuotas(
        [
            'last_active',
            'session_start',
            'session_end',
            'state',
            'gatewayMac',
            'mac',
            'rHid',
        ],
        [deviceQuotaId],
        [['id', '='], 'AND', ['staleReason', 'IS NULL']],
        [
            [
                'JOIN',
                ['nds_status', ['nds_status.custom', '=', 'device_quotas.id']],
            ],
        ],
    ) as Quota | Error;

    if (quotas instanceof Error) {
        writeLog().warn('Error fetching deauth device quota id', quotas);
        return quotas;
    }

    if (quotas.length === 0) {
        const error = new Error('Invalid device quota, empty result returned');
        writeLog().warn('Recieved an invalid device quota', error);

        database.transaction(() => {
            updateDeviceQuotas(
                ['staleReason'],
                [['id', '=']],
                ['shadowed_auth', deviceQuotaId],
            );

            updateAuths(
                ['active'],
                [
                    [
                        'deviceQuota',
                        'IN',
                        ['rHid', 'device_quotas', [['id', '=']]],
                    ],
                ],
                [false, deviceQuotaId],
            );
        })();
        return error;
    }

    if (quotas.length > 1) {
        const error = new Error(
            'Invalid device quota, multiple results were returned',
        );
        writeLog().warn('Recieved an invalid device quota', error);
        return error;
    }

    const quota = quotas[0];

    // Maybe check for edge case where quota.state != "Authenticated"

    // Get the last report of the client mac address
    const lastReports = getNdsStatus(
        ['state'],
        [quota.mac],
        [['mac', '=']],
        undefined,
        [['last_active', 'DESC', 'NULLS LAST']],
        [1],
    );

    if (lastReports instanceof Error) {
        writeLog().warn(
            'Error fetching lastReport device quota id',
            lastReports,
        );
        return lastReports;
    }

    if (lastReports.length === 0) {
        const error = new Error(
            'Invalid device quota, last reported was empty',
        );
        writeLog().warn('Recieved an invalid device quota', error);
        return error;
    }
    const lastReport = lastReports[0];
    // check if state and token has changed if so record
    // if report state is preauthenticated, update local device quotas else send deauth to NDS
    const staleReason =
        lastReport.state === 'Authenticated' ? 'user_init_deauth' : 'unknown';
    /*  Deauth involves setting device_quotas row to user_init_deauth,
        Once NDS reutnr report, respond wiht tokens from all rows with staleReason set to "user_init_deauth".
        Script on the NDS will  will call ndsctl deauth {token} to deauthenticate
        NDS will then report to FAS on successfull deauth by sending a deauth with reason set to ndsctl_deauth with auth hid which will be handled as normal deauth  and overwrite current stale reason
        */
    database.transaction(() => {
        updateDeviceQuotas(
            ['staleReason'],
            [['id', '=']],
            [staleReason, deviceQuotaId],
        );
        updateAuths(['active'], [['deviceQuota', '=']], [false, quota.rHid]);
    })();
}
