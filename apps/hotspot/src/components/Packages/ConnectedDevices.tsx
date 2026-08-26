import { Alert, Button, Stack } from '@mantine/core';
import {
    AiOutlineCheckCircle,
    AiOutlineExclamationCircle,
} from 'react-icons/ai';

import type { Quota } from '@radii/shared';
import { useContext, useEffect, useState } from 'react';
import { ModalActionsContext } from '../../App.tsx';
import { getStatus } from '../../lib/api.ts';

export function ConnectedDevice() {
    const { openConnectedDevices } = useContext(ModalActionsContext);
    const [quota, setQuota] = useState<Array<Quota> | undefined>();

    useEffect(() => {
        (async () => {
            const quota = await getStatus();
            if (quota.success) setQuota(quota.data);
        })();
    }, []);

    const isThisDevice = !!quota?.some((v) => v.thisDevice);
    const quotaMap = new Map<string, Array<Quota>>();

    quota?.forEach((v) => {
        if (quotaMap.has(v.parentQuotaId)) {
            quotaMap.set(v.parentQuotaId, [
                ...(quotaMap.get(v.parentQuotaId) || []),
                v,
            ]);
        } else {
            quotaMap.set(v.parentQuotaId, [v]);
        }
    });

    const canConnect = Array.from(quotaMap.entries()).some(
        ([_, v]) => v[0].maxDevices < v.filter((v) => !v.online).length,
    );

    if (Array.isArray(quota)) {
        if (quota.length > 0) {
            if (!isThisDevice) {
                return (
                    <Alert
                        color='red'
                        icon={<AiOutlineExclamationCircle size={24} />}
                        title={
                            canConnect
                                ? "This device doesn't have an active quota"
                                : 'Maximum devices reached'
                        }
                        mt='md'
                    >
                        <Stack gap='sm'>
                            <span>
                                {canConnect
                                    ? 'Disconnect and connect wifi to activate with an existing quota.'
                                    : 'All Packages are full, buy a new package or disconect an existing device.'}
                            </span>
                            <Button
                                color='red.2'
                                variant='outline'
                                onClick={openConnectedDevices}
                                size='xs'
                                mr='md'
                            >
                                See Connected
                            </Button>
                        </Stack>
                    </Alert>
                );
            } else {
                return (
                    <Alert
                        color='green'
                        icon={<AiOutlineCheckCircle size={24} />}
                        title='This device is active.'
                        mt='md'
                    >
                        <Stack gap='sm'>
                            <span>
                                You can manage your connected devices here.
                            </span>
                            <Button
                                variant='outline'
                                color='green'
                                onClick={openConnectedDevices}
                                size='xs'
                                mr='md'
                            >
                                See Connected
                            </Button>
                        </Stack>
                    </Alert>
                );
            }
        }
        if (quota?.length === 0) {
            return (
                <Alert
                    color='red'
                    variant='light'
                    icon={<AiOutlineExclamationCircle size={24} />}
                    title='No active package found'
                    mt='md'
                >
                    Buy a new package below to be able to browse the internet.
                </Alert>
            );
        }
        return null;
    } else {
        return (
            <Alert
                color='red'
                variant='light'
                icon={<AiOutlineExclamationCircle size={24} />}
                title='User not logged in'
                mt='md'
            >
                Login with your username and pin to be able to see you active
                quota status.
            </Alert>
        );
    }
}
