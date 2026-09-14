import {
    Anchor,
    Group,
    Loader,
    Modal,
    Stack,
    Table,
    Text,
} from '@mantine/core';
import { useState } from 'react';

import { deauthDevice } from '@lib/api.ts';
import {
    refreshPppoeAccounts,
    refreshPppoeQuota,
    usePppoeQuota,
} from '@lib/store.ts';
import { notifications } from '@mantine/notifications';
import humanFormat from 'human-format';
import { timeRemaining } from './functions.ts';
import { dataScale } from './PackagePricing.tsx';

interface Props {
    isOpen: boolean;
    onClose: () => void;
}
export function ConnectedDevicesModal({ isOpen, onClose }: Props) {
    const [pendingDeauth, setPendingDeauth] = useState<Array<string>>([]);
    const { quota } = usePppoeQuota(false);

    // Disconnects one live PPP session (targeted by its radacct id); the
    // package stays active so the dialer can reconnect with the same
    // credentials.
    const disconnectSession = async (
        activationId: string,
        radacctId: string,
    ) => {
        setPendingDeauth((prev) => [...prev, radacctId]);
        try {
            const result = await deauthDevice(activationId, radacctId);
            if (!result.success) {
                notifications.show({
                    color: 'red',
                    title: 'Disconnect failed',
                    message: result.message || 'Try again.',
                });
                return;
            }
            await Promise.all([
                refreshPppoeAccounts(),
                refreshPppoeQuota(),
            ]);
            notifications.show({
                title: 'Success',
                message: 'Session has been disconnected successfully',
            });
        } catch (err) {
            console.warn('Deauth failed', err);
        } finally {
            setPendingDeauth((prev) => prev.filter((id) => id !== radacctId));
        }
    };

    const rows = quota.flatMap((v) => {
        const title = v.downloadRate
            ? humanFormat(v.downloadRate, { scale: dataScale })
            : 'Unlimited';

        if (!v.liveSessions || v.liveSessions.length === 0) {
            return [
                <Table.Tr key={v.id}>
                    <Table.Td>-</Table.Td>
                    <Table.Td>
                        <Stack gap={0}>
                            <span>{v.username}</span>
                            <Text size='xs' c='dimmed' opacity={0.5}>
                                No session connected
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
                        {timeRemaining(v.remainingSeconds)}
                    </Table.Td>
                    <Table.Td>
                        <Text size='sm' c='dimmed'>
                            Configure your dialer with the credentials under
                            Your PPPoE Accounts.
                        </Text>
                    </Table.Td>
                </Table.Tr>,
            ];
        }

        return v.liveSessions.map((session, i) => (
            <Table.Tr key={session.radacctId}>
                <Table.Td>{i + 1}</Table.Td>
                <Table.Td>
                    <Stack gap={0}>
                        <span>{v.username}</span>
                        <Text size='xs' c='dimmed' opacity={0.5}>
                            {session.framedIpAddress ??
                                session.callingStationId ??
                                v.clientMac}
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
                    {timeRemaining(v.remainingSeconds)}
                </Table.Td>
                <Table.Td>
                    {pendingDeauth.includes(session.radacctId) ? (
                        <Group gap='xs' wrap='nowrap'>
                            <Loader size={14} />
                            <Text size='sm' c='dimmed'>
                                Disconnecting…
                            </Text>
                        </Group>
                    ) : (
                        <Anchor
                            component='button'
                            type='button'
                            size='sm'
                            c='red'
                            onClick={() =>
                                disconnectSession(v.id, session.radacctId)
                            }
                        >
                            Disconnect
                        </Anchor>
                    )}
                </Table.Td>
            </Table.Tr>
        ));
    });

    return (
        <Modal
            opened={isOpen}
            onClose={onClose}
            title={<Text fw={700}>PPPoE sessions</Text>}
            size='lg'
            centered
        >
            <Stack gap='md'>
                <Text size='sm' c='dimmed' fw={300}>
                    Manage your active PPPoE sessions below.
                </Text>
                <Table.ScrollContainer minWidth={500}>
                    <Table striped highlightOnHover>
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th>S/N</Table.Th>
                                <Table.Th>Dialer</Table.Th>
                                <Table.Th>Package</Table.Th>
                                <Table.Th>Time Left</Table.Th>
                                <Table.Th>Action</Table.Th>
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>{rows}</Table.Tbody>
                    </Table>
                </Table.ScrollContainer>
            </Stack>
        </Modal>
    );
}
