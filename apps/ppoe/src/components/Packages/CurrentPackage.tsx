import {
    refreshPppoeQuota,
    refreshPppoeAccounts,
    usePppoeAccounts,
    usePppoeQuota,
} from '@lib/store.ts';
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
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import humanFormat from 'human-format';
import { lazy, Suspense, useContext, useEffect, useState } from 'react';
import { AiOutlineInfoCircle } from 'react-icons/ai';
import { ModalActionsContext } from '../../App.tsx';
import { useSession } from '../../lib/auth.ts';
import { dayjs } from '../../lib/dayjs.ts';
import { activateScheduledPackage } from '../../lib/api.ts';
import classes from '../Credentials/PppoeAccountCard.module.css';
import { LoadingDialog } from '../LoadingDialog.tsx';
import { dataScale, formatPackagePrice } from './PackagePricing.tsx';
import { timeRemaining } from './functions.ts';

const ConnectedDevicesModal = lazy(() =>
    import('./ConnectedDevicesModal.tsx').then((m) => ({ default: m.ConnectedDevicesModal })),
);

export function CurrentPackage() {
    const { openLogin } = useContext(ModalActionsContext);
    const { data } = useSession();
    const { clients, selectedAccountId } = usePppoeAccounts();
    const { quota, error, loading } = usePppoeQuota(
        selectedAccountId,
        Boolean(data?.session),
    );
    const [isOpen, { open, close }] = useDisclosure();
    const [requested, setRequested] = useState(false);
    const [activating, setActivating] = useState<string | null>(null);
    const [confirmActivationId, setConfirmActivationId] = useState<string | null>(null);
    const selected = clients.find(
        (client) => client.accountId === selectedAccountId,
    );
    const thisDevice = quota.find((value) => value.id === selected?.activeActivation?.activationId) || quota[0];
    const nextStart = selected?.scheduledActivations[0]?.activatedAt;
    useEffect(() => {
        if (!nextStart) return;
        let timer: number;
        const scheduleRefresh = () => {
            const delay = new Date(nextStart).getTime() - Date.now();
            timer = window.setTimeout(() => {
                if (delay > 2_147_483_000) {
                    scheduleRefresh();
                } else {
                    void refreshPppoeAccounts();
                    void refreshPppoeQuota(selectedAccountId);
                }
            }, Math.min(2_147_483_000, Math.max(0, delay) + 250));
        };
        scheduleRefresh();
        return () => window.clearTimeout(timer);
    }, [nextStart, selectedAccountId]);

    const activateNow = async (activationId: string) => {
        if (!selected?.nasDeviceId || activating) return;
        setActivating(activationId);
        try {
            const result = await activateScheduledPackage(selected.accountId, activationId, selected.nasDeviceId);
            notifications.show({
                color: result.success ? 'green' : 'red',
                title: result.success ? 'Package activated' : 'Could not activate package',
                message: result.success
                    ? result.data?.reconnectPending
                        ? 'Your countdown has started. Reconnect your router to use the new package.'
                        : 'Your countdown has started. Your router will reconnect with the new package.'
                    : result.message,
            });
            await Promise.all([refreshPppoeAccounts(), refreshPppoeQuota(selected.accountId)]);
        } catch {
            notifications.show({ color: 'red', title: 'Could not refresh package', message: 'Refresh your service account to check whether activation completed before trying again.' });
        } finally {
            setActivating(null);
            setConfirmActivationId(null);
        }
    };
    const activePackage = thisDevice?.packageTitle
        ? thisDevice
        : selected?.activeActivation;
    const packageName = `${activePackage?.packageCategory ? `${activePackage.packageCategory} · ` : ''}${activePackage?.packageTitle ?? 'Current package'}`;
    const currentSession = thisDevice?.liveSessions?.[0];
    const speed =
        thisDevice?.online && currentSession?.live
            ? currentSession.currentSpeedBps
            : null;
    const currentTransferSpeed =
        speed == null
            ? '--'
            : speed === 0
              ? '0 Kbps'
              : humanFormat(speed / 1e3, { scale: dataScale });
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
                            wrap='nowrap'
                        >
                            <Box style={{ flex: 1, minWidth: 0 }}>
                                <Text size='xs' c='dimmed' mb={4}>
                                    Active package
                                </Text>
                                <Text
                                    className={classes.packageHeading}
                                    truncate
                                    title={packageName}
                                >
                                    {activePackage?.packageCategory ? (
                                        <span style={{ opacity: 0.65 }}>
                                            {activePackage.packageCategory} ·{' '}
                                        </span>
                                    ) : null}
                                    {activePackage?.packageTitle ?? 'Current package'}
                                </Text>
                            </Box>
                            <Text size='sm' fw={600} pt={4} style={{ flexShrink: 0 }}>
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
                                                selected.activeActivation
                                                    .expireAt,
                                            ).format('DD MMM YYYY HH:mm:ss')
                                          : 'Not available'}
                                </dd>
                            </div>
                            <div>
                                <dt>Current speed</dt>
                                <dd>{currentTransferSpeed}</dd>
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
                                onClick={() => {
                                    setRequested(true);
                                    open();
                                }}
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
                            <Text size='xs'>
                                Username: {thisDevice.username}
                            </Text>
                            <Text size='xs'>
                                Activation ID: {thisDevice.id}
                            </Text>
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
                            Choose a package below to get this service line
                            connected.
                        </Text>
                        <Text size='xs' c='dimmed'>
                            Last used:{' '}
                            {selected?.lastUsedAt
                                ? dayjs(selected.lastUsedAt).format(
                                      'DD MMM YYYY HH:mm:ss',
                                  )
                                : 'Not used yet'}
                        </Text>
                    </Stack>
                ) : null}
                {selected?.scheduledActivations.length ? (
                    <Stack gap='sm' mt='sm' aria-label='Scheduled packages'>
                        <Text fw={600}>Scheduled packages</Text>
                        <Text size='sm' c='dimmed'>
                            These packages have not started. Activate one now to start its countdown immediately.
                            Any current package keeps its existing expiry; other scheduled packages will follow without overlapping.
                        </Text>
                        {selected.scheduledActivations.map((activation) => (
                            <Paper key={activation.activationId} withBorder p='sm' radius='md'>
                                <Stack gap='xs'>
                                    <Text fw={600} size='sm'>
                                        {activation.packageCategory ? `${activation.packageCategory} · ` : ''}{activation.packageTitle}
                                    </Text>
                                    <Text size='xs' c='dimmed'>
                                        Starts {dayjs(activation.activatedAt).format('DD MMM YYYY HH:mm:ss')}
                                        {' · '}Expires {dayjs(activation.expireAt).format('DD MMM YYYY HH:mm:ss')}
                                    </Text>
                                    {confirmActivationId === activation.activationId ? (
                                        <Stack gap='xs'>
                                            <Text size='sm'>Start this package now instead of waiting? Its full purchased duration starts now, even if your current package still has time left.</Text>
                                            <Group gap='xs'>
                                                <Button size='xs' color='grape' loading={activating === activation.activationId} disabled={selected.status !== 'active' || !selected.availableOnPortal} onClick={() => void activateNow(activation.activationId)}>Confirm activation</Button>
                                                <Button size='xs' variant='subtle' disabled={activating !== null} onClick={() => setConfirmActivationId(null)}>Cancel</Button>
                                            </Group>
                                        </Stack>
                                    ) : (
                                        <Button size='xs' variant='light' color='grape' style={{ alignSelf: 'flex-start' }} disabled={activating !== null || selected.status !== 'active' || !selected.availableOnPortal} onClick={() => setConfirmActivationId(activation.activationId)}>Activate now</Button>
                                    )}
                                </Stack>
                            </Paper>
                        ))}
                    </Stack>
                ) : null}
            </Stack>
            {requested ? (
                <Suspense fallback={
                    <LoadingDialog title='Connected sessions' opened={isOpen} onClose={close} />
                }>
                    <ConnectedDevicesModal
                        accountId={selectedAccountId}
                        onClose={close}
                        isOpen={isOpen}
                    />
                </Suspense>
            ) : null}
        </Box>
    );
}
