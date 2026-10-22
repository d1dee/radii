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

import {
    refreshPppoeQuota,
    usePppoeAccounts,
    usePppoeQuota,
} from '@lib/store.ts';
import { useDisclosure } from '@mantine/hooks';
import { IconSelector } from '@tabler/icons-react';
import humanFormat from 'human-format';
import { useContext } from 'react';
import { AiOutlineInfoCircle } from 'react-icons/ai';
import { ModalActionsContext } from '../../App.tsx';
import { useSession } from '../../lib/auth.ts';
import { ConnectedDevice } from './ConnectedDevices.tsx';
import { ConnectedDevicesModal } from './ConnectedDevicesModal.tsx';
import {
    dataScale,
    formatPackagePrice,
} from './PackagePricing.tsx';

export function CurrentPackage() {
    const { openLogin } = useContext(ModalActionsContext);
    const { data } = useSession();
    const { selectedAccountId } = usePppoeAccounts();
    const { quota, error, loading } = usePppoeQuota(selectedAccountId);
    const [isOpen, { open, close }] = useDisclosure();

    // Prefer an online activation; fall back to the most recent one.
    const thisDevice = quota.find((v) => v.online) || quota[0];
    const currentSession = thisDevice?.liveSessions?.[0];
    const sessionAdjusted = currentSession?.remainingSeconds != null;
    const remainingSeconds =
        currentSession?.remainingSeconds ?? thisDevice?.remainingSeconds ?? 0;

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

    if (!data?.session) {
        // Nothing to report without a session: the visitor has no line yet,
        // so point them at the sign-in instead of an empty package.
        return (
            <Paper shadow='xl' radius='lg' p='lg' withBorder key=''>
                <Stack gap='sm'>
                    <Text size='lg' fw={600}>
                        Active Package Details
                    </Text>

                    <Alert
                        color='blue'
                        variant='light'
                        icon={<AiOutlineInfoCircle size={24} />}
                        title='Sign in to view your package'
                        mt='md'
                    >
                        <Stack gap='sm'>
                            <Text size='sm'>
                                Sign in to see your active package, the time
                                left on it, and the PPPoE credentials for your
                                network.
                            </Text>
                            <Button
                                color='blue'
                                variant='filled'
                                size='xs'
                                onClick={() => openLogin()}
                            >
                                Sign in
                            </Button>
                        </Stack>
                    </Alert>
                </Stack>
            </Paper>
        );
    }

    if (!thisDevice) {
        return (
            <Paper shadow='xl' radius='lg' p='lg' withBorder key=''>
                <Stack gap='sm'>
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
                                        void refreshPppoeQuota(selectedAccountId)
                                    }
                                >
                                    Try again
                                </Button>
                            </Stack>
                        </Alert>
                    ) : (
                        <ConnectedDevice quota={quota} onOpen={open} />
                    )}
                </Stack>
            </Paper>
        );
    }

    return (
        <>
            <Paper shadow='xl' radius='lg' p='lg' withBorder key=''>
                <Stack gap='sm'>
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
                                        void refreshPppoeQuota(selectedAccountId)
                                    }
                                >
                                    Retry
                                </Button>
                            </Group>
                        </Alert>
                    ) : null}

                    <Group justify='space-between'>
                        <Text size='sm' fw={500}>
                            {sessionAdjusted
                                ? 'Session time remaining'
                                : 'Time remaining'}
                        </Text>
                        <Text size='sm' fw={500}>
                            {timeRemaining(remainingSeconds)}
                        </Text>
                    </Group>

                    {sessionAdjusted ? (
                        <Group justify='space-between'>
                            <Text size='xs' c='dimmed'>
                                Package time remaining
                            </Text>
                            <Text size='xs' c='dimmed'>
                                {timeRemaining(thisDevice.remainingSeconds)}
                            </Text>
                        </Group>
                    ) : null}

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
                accountId={selectedAccountId}
                onClose={close}
                isOpen={isOpen}
            />
        </>
    );
}
