import { Anchor, Box, Modal, Stack, Table, Text } from '@mantine/core';
import { useEffect, useState } from 'react';

import type { Quota } from '@radii/shared';
import humanFormat from 'human-format';
import { FaSpinner } from 'react-icons/fa';
import { deauthDevice, getStatus } from '../../lib/api.ts';
import { dayjs } from '../../lib/dayjs.ts';
import { timeRemaining } from './functions.ts';
import { dataScale } from './PackagePricing.tsx';

export function ConnectedDevicesModal({
    opened,
    onClose,
}: {
    opened: boolean;
    onClose: () => void;
}) {
    const [deviceId, setDeviceId] = useState<string>('');
    const [pendingDeauth, setPendingDeauth] = useState<Array<string>>([]);

    useEffect(() => {
        const deauth = async () => {
            if (deviceId) {
                setPendingDeauth((prev) => [...prev, deviceId]);
                try {
                    await deauthDevice(deviceId);
                } catch (err) {
                    console.warn('Deauth failed', err);
                }
            }
        };
        deauth();
    }, [deviceId]);
    const [quota, setQuota] = useState<Array<Quota>>();

    useEffect(() => {
        (async () => {
            const quota = await getStatus();
            setQuota(quota.data);
        })();
    }, []);

    const rows = quota
        ?.toSorted((v) => (v.thisDevice ? -1 : 1))
        .map((v, i) => (
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
                <Table.Td>
                    <Stack gap={0}>
                        <span>
                            {humanFormat(v.downloadRate, {
                                scale: dataScale,
                            })}{' '}
                            - Ksh {v.price.toLocaleString()}
                        </span>
                        <Text size='xs' c='dimmed' opacity={0.5}>
                            {v.parentQuotaId}
                        </Text>
                    </Stack>
                </Table.Td>
                <Table.Td style={{ maxWidth: 130 }}>
                    {timeRemaining(
                        dayjs.duration(v.remainingSessionLength || 0, 'm'),
                    )}
                </Table.Td>
                <Table.Td>
                    {!pendingDeauth?.includes(v.deviceQuotaId) ? (
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
                        <Box c='red' style={{ cursor: 'wait' }}>
                            <FaSpinner className='animate-spin' />
                        </Box>
                    )}
                </Table.Td>
            </Table.Tr>
        ));

    return (
        <Modal
            opened={opened}
            onClose={onClose}
            title='Connected Devices'
            size='md'
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
        </Modal>
    );
}
