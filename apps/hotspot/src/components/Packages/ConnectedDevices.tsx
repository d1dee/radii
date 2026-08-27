import { Alert, Button, Stack } from '@mantine/core';
import {
    AiOutlineCheckCircle,
    AiOutlineExclamationCircle,
} from 'react-icons/ai';

import type { Quota } from '@radii/shared';
import { useContext, useEffect, useState } from 'react';
import { ModalActionsContext } from '../../App.tsx';
import { currentLoginRequestId, getStatus } from '../../lib/api.ts';

export function ConnectedDevice() {
    const { openConnectedDevices } = useContext(ModalActionsContext);
    const [quota, setQuota] = useState<Array<Quota> | undefined>();

    useEffect(() => {
        (async () => {
            const quota = await getStatus(currentLoginRequestId());
            if (quota.success) setQuota(quota.data);
        })();
    }, []);

    const isThisDevice = !!quota?.some((v) => v.thisDevice);

    // A slot for this device exists when at least one package has fewer
    // online devices (live sessions) than its max-devices allowance.
    const canConnect = quota?.some(
        (v) => (v.liveSessions?.length ?? 0) < v.maxDevices,
    );

    if (Array.isArray(quota)) {
        if (quota.length > 0) {
            if (!isThisDevice) {
                return (
                    <Alert
                        title={
                            canConnect
                                ? 'You are not connected'
                                : 'Maximum devices reached'
                        }
                        color={'orange'}
                        mt='md'
                    >
                        <Stack gap='sm'>
                            <span>
                                {canConnect
                                    ? 'Click below to activate an existing package.'
                                    : 'All Packages are full, buy a new package or disconect an existing device.'}
                            </span>
                            <Button
                                color='orange'
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
