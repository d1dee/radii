import {
    Badge,
    Button,
    Card,
    Center,
    Code,
    Divider,
    Drawer,
    Grid,
    Group,
    Loader,
    SimpleGrid,
    Stack,
    Text,
    Title,
} from '@mantine/core';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { MdDelete } from 'react-icons/md';

import {
    getAdminSession,
    type AdminSessionDetail,
    type PackagePaymentStatus,
    type SessionInfo,
} from '@/lib/api';
import {
    formatBytes,
    formatDateTime,
    formatMoney,
    formatSeconds,
    formatSpeed,
} from '@/lib/format';

const PAYMENT_STATUS_COLOR: Record<PackagePaymentStatus, string> = {
    paid: 'green',
    pending: 'orange',
    failed: 'red',
};

function DetailItem({ label, value }: { label: string; value: ReactNode }) {
    return (
        <Stack gap={2}>
            <Text size='xs' c='dimmed'>
                {label}
            </Text>
            <Text size='sm' fw={500} style={{ overflowWrap: 'anywhere' }}>
                {value}
            </Text>
        </Stack>
    );
}

function LinkedCard({
    label,
    children,
}: {
    label: string;
    children: ReactNode;
}) {
    return (
        <Card withBorder padding='md' radius='md'>
            <Text size='xs' c='dimmed' mb='xs'>
                {label}
            </Text>
            <Stack gap={4}>{children}</Stack>
        </Card>
    );
}

export function SessionDetailsDrawer({
    sessionId,
    onClose,
    onDisconnect,
}: {
    sessionId: string | null;
    onClose: () => void;
    onDisconnect: (session: SessionInfo) => void;
}) {
    const [detail, setDetail] = useState<AdminSessionDetail | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!sessionId) return;

        let ignore = false;
        setDetail(null);
        setError(null);

        void getAdminSession(sessionId).then((result) => {
            if (ignore) return;
            if (!result.success) {
                setError(result.message);
                return;
            }
            if (!result.data) {
                setError('Failed to load session details');
                return;
            }
            setDetail(result.data);
        });

        return () => {
            ignore = true;
        };
    }, [sessionId]);

    const session = detail?.session;

    return (
        <Drawer
            opened={sessionId !== null}
            onClose={onClose}
            position='right'
            size='xl'
            title={<Title order={4}>Session details</Title>}
        >
            {error ? (
                <Text c='red'>{error}</Text>
            ) : !detail || !session ? (
                <Center py='xl'>
                    <Loader />
                </Center>
            ) : (
                <Stack gap='lg'>
                    <Group justify='space-between' align='center'>
                        <Group gap='xs'>
                            <Badge
                                color={session.live ? 'green' : 'gray'}
                                variant='light'
                            >
                                {session.live ? 'Live' : 'Ended'}
                            </Badge>
                            {session.serviceType ? (
                                <Badge variant='outline'>
                                    {session.serviceType}
                                </Badge>
                            ) : null}
                            {session.framedProtocol ? (
                                <Badge variant='outline'>
                                    {session.framedProtocol}
                                </Badge>
                            ) : null}
                        </Group>
                        {session.live ? (
                            <Button
                                color='red'
                                variant='light'
                                leftSection={<MdDelete />}
                                onClick={() => onDisconnect(session)}
                            >
                                Disconnect
                            </Button>
                        ) : null}
                    </Group>

                    <Divider label='Connection' labelPosition='left' />

                    <Grid>
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                            <DetailItem
                                label='RADIUS username'
                                value={session.username || '—'}
                            />
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                            <DetailItem
                                label='Accounting session ID'
                                value={<Code>{session.acctSessionId}</Code>}
                            />
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                            <DetailItem
                                label='Client IP'
                                value={session.framedIpAddress ?? '—'}
                            />
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                            <DetailItem
                                label='Client MAC'
                                value={session.callingStationId ?? '—'}
                            />
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                            <DetailItem
                                label='Called station'
                                value={session.calledStationId ?? '—'}
                            />
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                            <DetailItem
                                label='NAS port'
                                value={
                                    [session.nasPortId, session.nasPortType]
                                        .filter(Boolean)
                                        .join(' · ') || '—'
                                }
                            />
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                            <DetailItem
                                label='Started'
                                value={
                                    session.startedAt
                                        ? formatDateTime(session.startedAt)
                                        : '—'
                                }
                            />
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                            <DetailItem
                                label={session.live ? 'Last update' : 'Ended'}
                                value={
                                    session.live
                                        ? session.updatedAt
                                            ? formatDateTime(session.updatedAt)
                                            : '—'
                                        : session.stoppedAt
                                          ? formatDateTime(session.stoppedAt)
                                          : '—'
                                }
                            />
                        </Grid.Col>
                        {!session.live ? (
                            <Grid.Col span={{ base: 12, sm: 6 }}>
                                <DetailItem
                                    label='Termination cause'
                                    value={session.terminateCause ?? '—'}
                                />
                            </Grid.Col>
                        ) : null}
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                            <DetailItem
                                label='Connection info'
                                value={
                                    session.connectInfoStop ??
                                    session.connectInfoStart ??
                                    '—'
                                }
                            />
                        </Grid.Col>
                    </Grid>

                    <Divider label='Usage' labelPosition='left' />

                    <SimpleGrid cols={{ base: 2, sm: 4 }}>
                        <LinkedCard label='Duration'>
                            <Text fw={700}>{formatSeconds(session.seconds)}</Text>
                        </LinkedCard>
                        <LinkedCard label='Total data'>
                            <Text fw={700}>
                                {formatBytes(session.totalOctets)}
                            </Text>
                        </LinkedCard>
                        <LinkedCard label='Download / upload'>
                            <Text fw={700} size='sm'>
                                {formatBytes(session.outputOctets)} /{' '}
                                {formatBytes(session.inputOctets)}
                            </Text>
                        </LinkedCard>
                        <LinkedCard label='Average speed'>
                            <Text fw={700}>
                                {formatSpeed(session.avgSpeedBps)}
                            </Text>
                        </LinkedCard>
                    </SimpleGrid>

                    <Divider label='Linked records' labelPosition='left' />

                    <SimpleGrid cols={{ base: 1, sm: 2 }}>
                        <LinkedCard label='NAS device'>
                            <Text fw={600}>{detail.nasDevice.name}</Text>
                            <Text size='sm' c='dimmed'>
                                {session.nasIpAddress}
                                {detail.nasDevice.location
                                    ? ` · ${detail.nasDevice.location}`
                                    : ''}
                            </Text>
                            <Code>{detail.nasDevice.id}</Code>
                        </LinkedCard>

                        <LinkedCard label='Customer'>
                            {detail.customer ? (
                                <>
                                    <Text fw={600}>
                                        {detail.customer.name ||
                                            'Unnamed customer'}
                                    </Text>
                                    <Text size='sm' c='dimmed'>
                                        {detail.customer.phoneNumber}
                                    </Text>
                                    <Code>{detail.customer.id}</Code>
                                </>
                            ) : (
                                <Text size='sm' c='dimmed'>
                                    No activation correlation was recorded.
                                </Text>
                            )}
                        </LinkedCard>

                        <LinkedCard label='Package'>
                            {detail.package ? (
                                <>
                                    <Group gap='xs'>
                                        <Text fw={600}>
                                            {detail.package.title}
                                        </Text>
                                        <Badge size='xs' variant='light'>
                                            {detail.package.type.toUpperCase()}
                                        </Badge>
                                    </Group>
                                    <Text size='sm' c='dimmed'>
                                        {detail.package.category}
                                    </Text>
                                    <Code>{detail.package.id}</Code>
                                </>
                            ) : (
                                <Text size='sm' c='dimmed'>
                                    No package could be linked.
                                </Text>
                            )}
                        </LinkedCard>

                        <LinkedCard label='Payment'>
                            {detail.payment ? (
                                <>
                                    <Group gap='xs'>
                                        <Text fw={600}>
                                            {formatMoney(detail.payment.amount)}
                                        </Text>
                                        <Badge
                                            size='xs'
                                            variant='light'
                                            color={
                                                PAYMENT_STATUS_COLOR[
                                                    detail.payment.status
                                                ]
                                            }
                                        >
                                            {detail.payment.status}
                                        </Badge>
                                    </Group>
                                    <Text size='sm' c='dimmed'>
                                        {formatDateTime(
                                            detail.payment.createdAt,
                                        )}
                                    </Text>
                                    <Code>{detail.payment.id}</Code>
                                </>
                            ) : (
                                <Text size='sm' c='dimmed'>
                                    No payment could be linked.
                                </Text>
                            )}
                        </LinkedCard>
                    </SimpleGrid>

                    {detail.activation ? (
                        <LinkedCard label='Activation'>
                            <Group justify='space-between'>
                                <Code>{detail.activation.id}</Code>
                                <Text size='xs' c='dimmed'>
                                    {formatDateTime(
                                        detail.activation.activatedAt,
                                    )}{' '}
                                    to {formatDateTime(detail.activation.expireAt)}
                                </Text>
                            </Group>
                        </LinkedCard>
                    ) : null}
                </Stack>
            )}
        </Drawer>
    );
}
