import { Box, Group, Paper, Progress, Stack, Text } from '@mantine/core';
import { useEffect, useState } from 'react';
import { IoMdArrowDown, IoMdArrowUp } from 'react-icons/io';
import { timeRemaining } from './functions.ts';

import { notifications } from '@mantine/notifications';
import humanFormat from 'human-format';
import { currentLoginRequestId, getStatus } from '../../lib/api.ts';
import { dayjs } from '../../lib/dayjs.ts';
import type { Quota } from '../../types/index.ts';
import { ConnectedDevice } from './ConnectedDevices.tsx';
import { dataScale } from './PackagePricing.tsx';
export function CurrentPackage() {
    const [onlineStatus, setOnlineStatus] = useState<{
        state: 'online' | 'offline' | '';
        prevState: 'online' | 'offline' | '';
    }>({ state: '', prevState: '' });

    const [quota, setQuota] = useState<Array<Quota>>();

    useEffect(() => {
        (async () => {
            const quota = await getStatus(currentLoginRequestId());
            if (quota.success) setQuota(quota.data);
        })();
    }, []);

    useEffect(() => {
        notifyOnlineStatus(
            onlineStatus.state,
            !!remainingSessionLength && remainingSessionLength > 0,
        );
    }, []);

    // Pick the highest if no token belongs to this devices
    const deviceQuota = quota?.find((v) => v.thisDevice) || (quota && quota[0]);

    const [signal] = useState<
        Partial<Array<Quota>[number]> & { width: string }
    >({
        ...deviceQuota,
        width:
            !deviceQuota?.sessionLength || !deviceQuota?.remainingSessionLength
                ? '0%'
                : Math.max(
                      0,
                      Math.min(
                          100,
                          (dayjs
                              .duration(
                                  deviceQuota?.remainingSessionLength || 0,
                                  'm',
                              )
                              .asSeconds() *
                              100) /
                              dayjs
                                  .duration(
                                      deviceQuota?.sessionLength || 0,
                                      'm',
                                  )
                                  .asSeconds(),
                      ),
                  ) + '%',
        remainingSessionLength: dayjs
            .duration(deviceQuota?.remainingSessionLength || 0, 'm')
            .asSeconds(),
        sessionLength: dayjs
            .duration(deviceQuota?.sessionLength || 0, 'm')
            .asSeconds(),
    });

    /* Run online status check every 20 seconds */
    useEffect(() => {
        const check = async () => {
            const isOnline = true; /* await checkOnlineStatus(); */

            // update online status
            if (isOnline) {
                setOnlineStatus((prev) => ({
                    prevState: prev.state,
                    state: 'online',
                }));
            } else {
                setOnlineStatus((prev) => ({
                    prevState: prev.state,
                    state: 'offline',
                }));
            }
        };
        // use exponensial backoff for online status check and update online status after three attempts
        check();

        // Poll every 20 seconds
        const interval = setInterval(check, 20e3);

        return () => clearInterval(interval);
    }, []);

    const {
        downloadRate,
        uploadRate,
        width,
        remainingSessionLength,
        deviceQuotaId,
    } = signal;

    const progressValue = Math.max(0, Math.min(100, parseFloat(width) || 0));

    return (
        <Paper shadow='xl' radius='lg' p='lg' mt='md' withBorder>
            <Stack gap='md'>
                <Text size='lg' fw={600}>
                    Active Package Details
                </Text>

                <Group justify='space-between'>
                    <Text size='sm' fw={500}>
                        Time remaining
                    </Text>
                    <Text size='sm' fw={500}>
                        {timeRemaining(
                            dayjs.duration(remainingSessionLength || 0, 's'),
                        )}
                    </Text>
                </Group>

                <Progress
                    value={progressValue}
                    size='sm'
                    radius='xl'
                    color='grape'
                />

                <Stack gap='xs'>
                    <Group justify='space-between' gap='sm'>
                        <Text size='sm' c='dimmed'>
                            Devices: {quota?.length || ' _'}
                        </Text>
                        <Text size='sm' c='dimmed'>
                            Package info:{' '}
                            {deviceQuota?.downloadRate
                                ? `${humanFormat(deviceQuota.downloadRate, {
                                      scale: dataScale,
                                  })} - Ksh ${deviceQuota.price.toLocaleString()}`
                                : ' _'}
                        </Text>
                        <Group gap='sm'>
                            <Group gap='xs'>
                                <IoMdArrowDown />
                                <Text size='sm' c='dimmed'>
                                    {downloadRate && downloadRate !== 0
                                        ? humanFormat(downloadRate, {
                                              scale: dataScale,
                                          })
                                        : ' _'}
                                </Text>
                            </Group>
                            <Group gap='xs'>
                                <IoMdArrowUp />
                                <Text size='sm' c='dimmed'>
                                    {uploadRate && uploadRate !== 0
                                        ? humanFormat(uploadRate, {
                                              scale: dataScale,
                                          })
                                        : ' _'}
                                </Text>
                            </Group>
                        </Group>
                    </Group>

                    <Group justify='space-between' gap='sm'>
                        <Text size='sm' c='dimmed'>
                            Quota ID: {deviceQuotaId || ' _'}
                        </Text>
                        <Text size='sm' c='dimmed'>
                            Parent Quota: {deviceQuota?.parentQuotaId || ' _'}
                        </Text>
                    </Group>

                    <Box>
                        <ConnectedDevice />
                    </Box>
                </Stack>
            </Stack>
        </Paper>
    );
}

function notifyOnlineStatus(
    status: 'online' | 'offline' | '',
    hasSession: boolean,
) {
    if (status === 'online')
        notifications.show({
            title: 'You are back online.',
            message: 'You can now surf the internet.',
        });
    if (status === 'offline')
        notifications.show({
            title: 'You are offline.',
            message: hasSession
                ? 'Turn your wifi off and on again.'
                : 'Purchase one of the packages below to access the internet.',
        });
}
