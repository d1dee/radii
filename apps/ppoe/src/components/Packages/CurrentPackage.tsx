import {
    Box,
    Grid,
    Group,
    Paper,
    Progress,
    SimpleGrid,
    Stack,
    Text,
} from '@mantine/core';
import { useEffect, useState } from 'react';
import { timeRemaining } from './functions.ts';

import type { Quota } from '@/types/index.ts';
import { getStatus } from '@lib/api.ts';
import { useDisclosure, useInterval } from '@mantine/hooks';
import { IconSelector } from '@tabler/icons-react';
import humanFormat from 'human-format';
import { ConnectedDevice } from './ConnectedDevices.tsx';
import { ConnectedDevicesModal } from './ConnectedDevicesModal.tsx';
import { dataScale } from './PackagePricing.tsx';

export function CurrentPackage() {
    const [quota, setQuota] = useState<Array<Quota>>([]);
    const [isOpen, { open, close }] = useDisclosure();
    const fetchQuota = async () => {
        const quota = await getStatus();
        if (quota.success) setQuota(quota.data ?? []);
    };
    const interval = useInterval(fetchQuota, 5e3);
    useEffect(() => {
        fetchQuota().finally(interval.start);
        return interval.stop;
    }, []);

    // Prefer an online activation; fall back to the most recent one.
    const thisDevice = quota.find((v) => v.online) || quota[0];

    const progressValue = thisDevice
        ? Math.max(
              0,
              Math.min(
                  100,
                  (thisDevice.remainingSeconds /
                      (thisDevice.sessionLimitSeconds || 1)) *
                      100,
              ),
          )
        : 0;

    const avgTransferSpeed = thisDevice?.avgSpeedBps
        ? humanFormat(thisDevice?.avgSpeedBps / 1e3, {
              scale: dataScale,
          })
        : '_';
    const title = thisDevice?.packageTitle
        ? `${thisDevice?.packageTitle} @ Ksh ${thisDevice?.price}`
        : '_';

    return (
        <>
            <Paper shadow='xl' radius='lg' p='lg' withBorder key=''>
                <Stack gap='md'>
                    <Text size='lg' fw={600}>
                        Active Package Details
                    </Text>

                    <Group justify='space-between'>
                        <Text size='sm' fw={500}>
                            Time remaining
                        </Text>
                        <Text size='sm' fw={500}>
                            {timeRemaining(thisDevice?.remainingSeconds || 0)}
                        </Text>
                    </Group>

                    <Progress
                        value={progressValue}
                        size='sm'
                        radius='xl'
                        color='grape'
                    />

                    <Stack gap='xs'>
                        <SimpleGrid cols={3}>
                            <Text size='sm' c='dimmed'>
                                Sessions:{' '}
                                {thisDevice?.liveSessions?.length || ' _'}
                            </Text>
                            <Text size='sm' c='dimmed'>
                                Package title: {title}
                            </Text>

                            <Group gap='xs'>
                                <IconSelector stroke={1} />
                                <Text size='sm' c='dimmed'>
                                    {avgTransferSpeed}
                                </Text>
                            </Group>
                        </SimpleGrid>

                        <Grid>
                            <Grid.Col span={4}>
                                <Text size='sm' c='dimmed'>
                                    Username: {thisDevice?.username || ' _'}
                                </Text>
                            </Grid.Col>
                            <Grid.Col span={8}>
                                <Text size='sm' c='dimmed'>
                                    Activation Id: {thisDevice?.id || ' _'}
                                </Text>
                            </Grid.Col>
                        </Grid>

                        <Box>
                            <ConnectedDevice quota={quota} onOpen={open} />
                        </Box>
                    </Stack>
                </Stack>
            </Paper>
            <ConnectedDevicesModal
                onClose={close}
                isOpen={isOpen}
                syncQuota={setQuota}
            />
        </>
    );
}
