import {
    Alert,
    Box,
    Button,
    Grid,
    Group,
    Paper,
    Progress,
    SimpleGrid,
    Stack,
    Text,
} from '@mantine/core';
import { timeRemaining } from './functions.ts';

import { currentLoginRequestId } from '@lib/api.ts';
import { refreshHotspotQuota, useHotspotQuota } from '@lib/store.ts';
import { useDisclosure } from '@mantine/hooks';
import { IconSelector } from '@tabler/icons-react';
import humanFormat from 'human-format';
import { ConnectedDevice } from './ConnectedDevices.tsx';
import { ConnectedDevicesModal } from './ConnectedDevicesModal.tsx';
import { dataScale, formatPackagePrice } from './functions.ts';

export function CurrentPackage() {
    const loginRequestId = currentLoginRequestId();
    const { quota, error, loading } = useHotspotQuota(loginRequestId);
    const [isOpen, { open, close }] = useDisclosure();

    // Pick the highest if no token belongs to this devices
    const thisDevice = quota.find((v) => v.thisDevice && v.online) || quota[0];

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
        ? `${thisDevice.packageTitle} @ ${formatPackagePrice(thisDevice.price)}`
        : '_';

    if (!thisDevice) {
        return (
            <Paper shadow='xl' radius='lg' p='lg' withBorder>
                <Stack gap='md'>
                    <Text size='lg' fw={600}>
                        Active Package Details
                    </Text>
                    {loading && !error ? (
                        <Text c='dimmed'>Loading active package…</Text>
                    ) : error ? (
                        <Alert
                            color='red'
                            title='Could not load your active package'
                        >
                            <Stack gap='sm'>
                                <Text size='sm'>{error}</Text>
                                <Button
                                    color='red'
                                    variant='light'
                                    onClick={() =>
                                        void refreshHotspotQuota(loginRequestId)
                                    }
                                >
                                    Try again
                                </Button>
                            </Stack>
                        </Alert>
                    ) : (
                        <Alert color='blue' title='No active package'>
                            Buy a package below to get connected.
                        </Alert>
                    )}
                </Stack>
            </Paper>
        );
    }

    return (
        <>
            <Paper shadow='xl' radius='lg' p='lg' withBorder key=''>
                <Stack gap='md'>
                    <Text size='lg' fw={600}>
                        Active Package Details
                    </Text>

                    {error ? (
                        <Alert
                            color='orange'
                            title='Showing saved package data'
                        >
                            <Group justify='space-between'>
                                <Text size='sm'>{error}</Text>
                                <Button
                                    size='xs'
                                    variant='light'
                                    color='orange'
                                    onClick={() =>
                                        void refreshHotspotQuota(loginRequestId)
                                    }
                                >
                                    Retry
                                </Button>
                            </Group>
                        </Alert>
                    ) : null}

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
                                Devices:{' '}
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
            <ConnectedDevicesModal onClose={close} isOpen={isOpen} />
        </>
    );
}
