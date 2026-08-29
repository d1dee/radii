import {
    Anchor,
    Group,
    Loader,
    Modal,
    Stack,
    Table,
    Text,
} from '@mantine/core';
import { useEffect, useRef, useState } from 'react';

import {
    completeLoginRequest,
    currentLoginRequestId,
    deauthDevice,
    getStatus,
    type HotspotRedirectData,
} from '@lib/api.ts';
import { dayjs } from '@lib/dayjs.ts';
import { notifications } from '@mantine/notifications';
import type { Quota } from '@radii/shared';
import humanFormat from 'human-format';
import { timeRemaining } from './functions.ts';
import { dataScale } from './PackagePricing.tsx';

interface Props {
    isOpen: boolean;
    onClose: () => void;
}
export function ConnectedDevicesModal({ isOpen, onClose }: Props) {
    const [deviceId, setDeviceId] = useState<string>('');
    const [pendingDeauth, setPendingDeauth] = useState<Array<string>>([]);
    const [pendingConnect, setPendingConnect] = useState<Array<string>>([]);
    const [connectRedirect, setConnectRedirect] =
        useState<HotspotRedirectData | null>(null);
    const formRef = useRef<HTMLFormElement>(null);
    const submitted = useRef(false);

    const [quota, setQuota] = useState<Array<Quota>>();

    useEffect(() => {
        const deauth = async () => {
            if (deviceId) {
                setPendingDeauth((prev) => [...prev, deviceId]);
                try {
                    // Target the device's live session when known (single
                    // session); the backend disconnects all sessions of the
                    // package when no session id is given.
                    const session = quota?.find(
                        (v) => v.deviceQuotaId === deviceId,
                    )?.liveSessions?.[0];
                    await deauthDevice(deviceId, session?.radacctId);
                    const refreshed = await getStatus(currentLoginRequestId());
                    if (refreshed.success) {
                        setQuota(refreshed.data);
                        notifications.show({
                            title: 'Success',
                            message:
                                'Device has been disconnected successfully',
                        });
                    }
                } catch (err) {
                    console.warn('Deauth failed', err);
                } finally {
                    setPendingDeauth((prev) =>
                        prev.filter((id) => id !== deviceId),
                    );
                    setDeviceId('');
                }
            }
        };
        deauth();
    }, [deviceId]);

    useEffect(() => {
        (async () => {
            const quota = await getStatus(currentLoginRequestId());
            if (quota.success) setQuota(quota.data);
        })();
    }, []);

    // Connects this device using an offline activation: the backend returns its
    // RADIUS credentials plus the NAS servlet link, which are re-submitted as
    // a form post (same final hop as after a purchase), logging this client
    // into the hotspot.
    const connectDevice = async (deviceQuotaId: string) => {
        const loginRequestId = currentLoginRequestId();
        if (!loginRequestId) {
            notifications.show({
                color: 'red',
                title: 'Cannot connect',
                message:
                    'Hotspot session expired. Turn your wifi off and on again.',
            });
            return;
        }
        setPendingConnect((prev) => [...prev, deviceQuotaId]);
        try {
            const res = await completeLoginRequest(
                loginRequestId,
                deviceQuotaId,
            );
            if (res.success && res.data?.linkLoginOnly) {
                setConnectRedirect(res.data);
                return; // spinner stays until the form navigates the page away
            }
            notifications.show({
                color: 'red',
                title: 'Could not connect',
                message: res.success
                    ? 'Try again.'
                    : res.message || 'Try again.',
            });
        } catch (err) {
            console.warn('Connect failed', err);
        }
        setPendingConnect((prev) => prev.filter((id) => id !== deviceQuotaId));
    };

    useEffect(() => {
        if (connectRedirect && !submitted.current && formRef.current) {
            submitted.current = true;
            formRef.current.submit();
        }
    }, [connectRedirect]);

    const rows = quota
        ?.toSorted((v) => (v.thisDevice ? -1 : 1))
        .map((v, i) => {
            const title = v.downloadRate
                ? humanFormat(v.downloadRate, {
                      scale: dataScale,
                  })
                : 'Unlimited';

            return (
                <Table.Tr
                    key={v.deviceQuotaId}
                    bg={v.thisDevice ? 'grape.0' : undefined}
                >
                    <Table.Td>{i + 1}</Table.Td>
                    <Table.Td>
                        <Stack gap={0}>
                            <span>{v.deviceQuotaId}</span>
                            <Text size='xs' c='dimmed' opacity={0.5}>
                                {v.clientMac}
                            </Text>
                        </Stack>
                    </Table.Td>
                    <Table.Td miw='120'>
                        <Stack gap={0}>
                            <span>{v.packageTitle}</span>
                            <Text size='xs' c='dimmed' opacity={0.5}>
                                {title} - Ksh {v.price.toLocaleString()}
                            </Text>
                        </Stack>
                    </Table.Td>
                    <Table.Td style={{ maxWidth: 130 }}>
                        {timeRemaining(
                            dayjs.duration(v.remainingSessionLength || 0, 'm'),
                        )}
                    </Table.Td>
                    <Table.Td>
                        {pendingDeauth.includes(v.deviceQuotaId) ? (
                            <Group gap='xs' wrap='nowrap'>
                                <Loader size={14} />
                                <Text size='sm' c='dimmed'>
                                    Disconnecting…
                                </Text>
                            </Group>
                        ) : pendingConnect.includes(v.deviceQuotaId) ? (
                            <Group gap='xs' wrap='nowrap'>
                                <Loader size={14} color='green' />
                                <Text size='sm' c='dimmed'>
                                    Connecting…
                                </Text>
                            </Group>
                        ) : v.online ? (
                            <Anchor
                                component='button'
                                type='button'
                                size='sm'
                                c='red'
                                onClick={() => setDeviceId(v.deviceQuotaId)}
                            >
                                Disconnect
                            </Anchor>
                        ) : (
                            <Anchor
                                component='button'
                                type='button'
                                size='sm'
                                c='green'
                                onClick={() => connectDevice(v.deviceQuotaId)}
                            >
                                Connect
                            </Anchor>
                        )}
                    </Table.Td>
                </Table.Tr>
            );
        });

    return (
        <Modal
            opened={isOpen}
            onClose={onClose}
            title={<Text fw={700}>Avaible connections</Text>}
            size='lg'
            centered
        >
            <Stack gap='md'>
                <Text size='sm' c='dimmed' fw={300}>
                    Manage your connected devices below.
                </Text>
                <Table.ScrollContainer minWidth={500}>
                    <Table striped highlightOnHover>
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th>S/N</Table.Th>
                                <Table.Th>Device</Table.Th>
                                <Table.Th>Package</Table.Th>
                                <Table.Th>Time Left</Table.Th>
                                <Table.Th>Action</Table.Th>
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>{rows}</Table.Tbody>
                    </Table>
                </Table.ScrollContainer>
            </Stack>

            {connectRedirect && (
                <form
                    ref={formRef}
                    action={connectRedirect.linkLoginOnly}
                    method='post'
                >
                    <input
                        type='hidden'
                        name='username'
                        value={connectRedirect.username}
                    />
                    <input
                        type='hidden'
                        name='password'
                        value={connectRedirect.password}
                    />
                    <input type='hidden' name='domain' value='' />
                    <input
                        type='hidden'
                        name='dst'
                        value={connectRedirect.dst}
                    />
                    <input type='hidden' name='popup' value='true' />
                </form>
            )}
        </Modal>
    );
}
