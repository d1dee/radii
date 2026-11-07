import {
    Alert,
    Box,
    Button,
    Group,
    Paper,
    Progress,
    Stack,
    Text,
} from '@mantine/core';
import {
    refreshPppoeQuota,
    usePppoeAccounts,
    usePppoePortal,
    usePppoeQuota,
} from '@lib/store.ts';
import { useDisclosure } from '@mantine/hooks';
import humanFormat from 'human-format';
import { useContext } from 'react';
import { AiOutlineInfoCircle } from 'react-icons/ai';
import { ModalActionsContext } from '../../App.tsx';
import { useSession } from '../../lib/auth.ts';
import { dayjs } from '../../lib/dayjs.ts';
import classes from '../Credentials/PppoeAccountCard.module.css';
import { ConnectedDevicesModal } from './ConnectedDevicesModal.tsx';
import { dataScale, formatPackagePrice } from './PackagePricing.tsx';
import { timeRemaining } from './functions.ts';

export function CurrentPackage() {
    const { openLogin } = useContext(ModalActionsContext);
    const { data } = useSession();
    const { clients, selectedAccountId } = usePppoeAccounts();
    const { packages } = usePppoePortal();
    const { quota, error, loading } = usePppoeQuota(
        selectedAccountId,
        Boolean(data?.session),
    );
    const [isOpen, { open, close }] = useDisclosure();
    const selected = clients.find(
        (client) => client.accountId === selectedAccountId,
    );
    const thisDevice = quota.find((value) => value.online) || quota[0];
    const packageCategory = packages
        ?.flatMap(([, items]) => items)
        .find((pkg) => pkg.packageId === thisDevice?.packageId)?.category;
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
                      (thisDevice.sessionLimitSeconds || 1)) * 100,
              ),
          )
        : 0;

    if (!data?.session) {
        return (
            <Paper radius='lg' p='lg' withBorder>
                <Alert
                    color='blue'
                    variant='light'
                    icon={<AiOutlineInfoCircle size={24} />}
                    title='Sign in to view your package'
                >
                    <Stack gap='sm'>
                        <Text size='sm'>
                            Sign in to see your active package, the time left on
                            it, and the PPPoE credentials for your network.
                        </Text>
                        <Button size='xs' onClick={() => openLogin()}>
                            Sign in
                        </Button>
                    </Stack>
                </Alert>
            </Paper>
        );
    }

    return (
        <Box
            component='section'
            aria-label='Active package'
            className={classes.packageSection}
        >
            <Stack gap='xs'>
                {error ? (
                    <Alert
                        color={thisDevice ? 'orange' : 'red'}
                        title={
                            thisDevice
                                ? 'Showing saved package data'
                                : 'Could not load your active package'
                        }
                    >
                        <Stack gap='sm'>
                            <Text size='sm'>{error}</Text>
                            <Button
                                size='xs'
                                variant='light'
                                color={thisDevice ? 'orange' : 'red'}
                                onClick={() =>
                                    void refreshPppoeQuota(selectedAccountId)
                                }
                            >
                                Try again
                            </Button>
                        </Stack>
                    </Alert>
                ) : null}

                {thisDevice ? (
                    <>
                        <Group
                            justify='space-between'
                            align='flex-start'
                            gap='sm'
                        >
                            <Box style={{ flex: 1, minWidth: 0 }}>
                                <Text size='xs' c='dimmed' mb={4}>
                                    Active package
                                </Text>
                                <Text className={classes.packageHeading}>
                                    {packageCategory ? `${packageCategory} · ` : ''}
                                    {thisDevice.packageTitle ??
                                        selected?.activeActivation?.packageTitle ??
                                        'Current package'}
                                </Text>
                            </Box>
                            <Text size='sm' fw={600} pt={4}>
                                {formatPackagePrice(thisDevice.price)}
                            </Text>
                        </Group>

                        <Stack gap={4}>
                            <Group
                                justify='space-between'
                                align='baseline'
                                gap='xs'
                            >
                                <Text size='sm' c='dimmed'>
                                    {sessionAdjusted
                                        ? 'Session time remaining'
                                        : 'Time remaining'}
                                </Text>
                                <Text size='lg' fw={650}>
                                    {timeRemaining(remainingSeconds)}
                                </Text>
                            </Group>
                            <Progress
                                value={progressValue}
                                size={6}
                                radius='xl'
                                color='grape'
                                aria-label='Package time remaining'
                            />
                            {sessionAdjusted ? (
                                <Text size='xs' c='dimmed'>
                                    Package time remaining:{' '}
                                    {timeRemaining(thisDevice.remainingSeconds)}
                                </Text>
                            ) : null}
                        </Stack>

                        <dl className={classes.packageStats}>
                            <div>
                                <dt>Expires</dt>
                                <dd>
                                    {thisDevice.noExpiry
                                        ? 'No expiry'
                                        : selected?.activeActivation
                                          ? dayjs(
                                                selected.activeActivation.expireAt,
                                            ).format('DD MMM YYYY HH:mm:ss')
                                          : 'Not available'}
                                </dd>
                            </div>
                            <div>
                                <dt>Average transfer speed</dt>
                                <dd>
                                    {thisDevice.avgSpeedBps
                                        ? humanFormat(
                                              thisDevice.avgSpeedBps / 1e3,
                                              { scale: dataScale },
                                          )
                                        : 'No traffic yet'}
                                </dd>
                            </div>
                        </dl>

                        <Group justify='space-between' gap='sm'>
                            <Text size='sm' c='dimmed'>
                                {thisDevice.liveSessions?.length ?? 0} connected{' '}
                                {thisDevice.liveSessions?.length === 1
                                    ? 'session'
                                    : 'sessions'}
                            </Text>
                            <Button
                                size='xs'
                                variant='light'
                                color='grape'
                                onClick={open}
                            >
                                Manage sessions
                            </Button>
                        </Group>
                        {!thisDevice.online ? (
                            <Text size='sm' c='dimmed'>
                                Your package is active. Use the credentials in
                                Router setup below to connect.
                            </Text>
                        ) : null}
                        <details className={classes.packageMeta}>
                            <summary>Package reference</summary>
                            <Text size='xs'>Username: {thisDevice.username}</Text>
                            <Text size='xs'>Activation ID: {thisDevice.id}</Text>
                        </details>
                    </>
                ) : loading && !error ? (
                    <Text size='sm' c='dimmed' role='status'>
                        Loading active package...
                    </Text>
                ) : !error ? (
                    <Stack gap={4}>
                        <Text fw={600}>No active package</Text>
                        <Text size='sm' c='dimmed'>
                            Choose a package below to get this service line connected.
                        </Text>
                        <Text size='xs' c='dimmed'>
                            Last used:{' '}
                            {selected?.lastUsedAt
                                ? dayjs(selected.lastUsedAt).format('DD MMM YYYY HH:mm:ss')
                                : 'Not used yet'}
                        </Text>
                    </Stack>
                ) : null}
            </Stack>
            <ConnectedDevicesModal
                accountId={selectedAccountId}
                onClose={close}
                isOpen={isOpen}
            />
        </Box>
    );
}
