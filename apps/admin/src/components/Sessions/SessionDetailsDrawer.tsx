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

type ActivationEvent = NonNullable<
    AdminSessionDetail['activation']
>['events'][number];

const EVENT_LABELS: Record<ActivationEvent['type'], string> = {
    created: 'Package activated',
    reactivated: 'Activation restored',
    deactivated: 'Activation deactivated',
    limits_adjusted: 'Activation limits adjusted',
    session_timeout_adjusted: 'Session timeout adjusted',
};

function metadataNumber(metadata: Record<string, unknown>, key: string) {
    const value = metadata[key];
    return typeof value === 'number' ? value : null;
}

function metadataDate(metadata: Record<string, unknown>, key: string) {
    const value = metadata[key];
    return typeof value === 'string' ? value : null;
}

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
    const auditItems = detail?.activation
        ? [
              ...detail.activation.events.map((event) => ({
                  kind: 'event' as const,
                  at: event.createdAt,
                  event,
              })),
              ...detail.activation.consumption.map((consumption) => ({
                  kind: 'consumption' as const,
                  at: consumption.startedAt,
                  consumption,
              })),
          ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
        : [];

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

                        <LinkedCard label='PPPoE service account'>
                            {detail.serviceAccount ? (
                                <>
                                    <Group gap='xs'>
                                        <Text fw={600}>
                                            {detail.serviceAccount.label ||
                                                detail.serviceAccount.username}
                                        </Text>
                                        <Badge size='xs' variant='light'>
                                            {detail.serviceAccount.status}
                                        </Badge>
                                    </Group>
                                    <Text size='sm' c='dimmed'>
                                        {detail.serviceAccount.username}
                                    </Text>
                                    <Text size='sm' c='dimmed'>
                                        Last used:{' '}
                                        {detail.serviceAccount.lastUsedAt
                                            ? formatDateTime(
                                                  detail.serviceAccount.lastUsedAt,
                                              )
                                            : 'Never'}
                                    </Text>
                                    <Code>{detail.serviceAccount.id}</Code>
                                </>
                            ) : (
                                <Text size='sm' c='dimmed'>
                                    This session is not linked to a PPPoE
                                    service account.
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
                            <Group justify='space-between' align='flex-start'>
                                <Code>{detail.activation.id}</Code>
                                <Text size='xs' c='dimmed'>
                                    {formatDateTime(
                                        detail.activation.activatedAt,
                                    )}{' '}
                                    to {formatDateTime(detail.activation.expireAt)}
                                </Text>
                            </Group>
                            <SimpleGrid cols={{ base: 1, sm: 3 }} mt='sm'>
                                <DetailItem
                                    label={
                                        detail.activation.balance.mode ===
                                        'cumulative'
                                            ? 'Total allowance'
                                            : 'Validity window'
                                    }
                                    value={formatSeconds(
                                        detail.activation.balance.totalSeconds,
                                    )}
                                />
                                <DetailItem
                                    label='Accounting usage'
                                    value={formatSeconds(
                                        detail.activation.balance.usedSeconds,
                                    )}
                                />
                                <DetailItem
                                    label={
                                        detail.activation.balance.mode ===
                                        'cumulative'
                                            ? 'Balance remaining'
                                            : 'Validity remaining'
                                    }
                                    value={formatSeconds(
                                        detail.activation.balance
                                            .remainingSeconds,
                                    )}
                                />
                            </SimpleGrid>
                        </LinkedCard>
                    ) : null}

                    {detail.activation ? (
                        <>
                            <Divider
                                label='Activation audit'
                                labelPosition='left'
                            />
                            {auditItems.length === 0 ? (
                                <Text size='sm' c='dimmed'>
                                    No lifecycle or accounting history recorded.
                                </Text>
                            ) : (
                                <Stack gap='xs'>
                                    {auditItems.map((item) => {
                                        if (item.kind === 'consumption') {
                                            const usage = item.consumption;
                                            return (
                                                <Card
                                                    key={`usage-${usage.radacctId}`}
                                                    withBorder
                                                    padding='sm'
                                                    radius='md'
                                                    bg={
                                                        usage.radacctId ===
                                                        session.radacctId
                                                            ? 'var(--mantine-color-blue-light)'
                                                            : undefined
                                                    }
                                                >
                                                    <Group
                                                        justify='space-between'
                                                        align='flex-start'
                                                    >
                                                        <Stack gap={2}>
                                                            <Group gap='xs'>
                                                                <Badge
                                                                    size='xs'
                                                                    variant='light'
                                                                    color='blue'
                                                                >
                                                                    Usage
                                                                </Badge>
                                                                <Text
                                                                    size='sm'
                                                                    fw={600}
                                                                >
                                                                    Session consumed{' '}
                                                                    {formatSeconds(
                                                                        usage.seconds,
                                                                    )}
                                                                </Text>
                                                            </Group>
                                                            <Text
                                                                size='xs'
                                                                c='dimmed'
                                                            >
                                                                {formatBytes(
                                                                    usage.totalOctets,
                                                                )}{' '}
                                                                ·{' '}
                                                                {usage.callingStationId ??
                                                                    usage.framedIpAddress ??
                                                                    'Unknown device'}
                                                                {usage.terminateCause
                                                                    ? ` · ${usage.terminateCause}`
                                                                    : ''}
                                                            </Text>
                                                        </Stack>
                                                        <Text
                                                            size='xs'
                                                            c='dimmed'
                                                            ta='right'
                                                        >
                                                            {formatDateTime(
                                                                usage.startedAt,
                                                            )}
                                                            {usage.stoppedAt
                                                                ? ` to ${formatDateTime(usage.stoppedAt)}`
                                                                : ' · Live'}
                                                        </Text>
                                                    </Group>
                                                </Card>
                                            );
                                        }

                                        const event = item.event;
                                        const previousExpiry = metadataDate(
                                            event.metadata,
                                            'previousExpireAt',
                                        );
                                        const expiry = metadataDate(
                                            event.metadata,
                                            'expireAt',
                                        );
                                        const remaining = metadataNumber(
                                            event.metadata,
                                            'requestedRemainingSeconds',
                                        );
                                        const timeout = metadataNumber(
                                            event.metadata,
                                            'sessionTimeoutSeconds',
                                        );
                                        return (
                                            <Card
                                                key={`event-${event.id}`}
                                                withBorder
                                                padding='sm'
                                                radius='md'
                                            >
                                                <Group
                                                    justify='space-between'
                                                    align='flex-start'
                                                >
                                                    <Stack gap={2}>
                                                        <Group gap='xs'>
                                                            <Badge
                                                                size='xs'
                                                                variant='light'
                                                                color='grape'
                                                            >
                                                                Audit
                                                            </Badge>
                                                            <Text
                                                                size='sm'
                                                                fw={600}
                                                            >
                                                                {
                                                                    EVENT_LABELS[
                                                                        event.type
                                                                    ]
                                                                }
                                                            </Text>
                                                        </Group>
                                                        <Text
                                                            size='xs'
                                                            c='dimmed'
                                                        >
                                                            {event.actor.label} ·{' '}
                                                            {event.source.replaceAll(
                                                                '_',
                                                                ' ',
                                                            )}
                                                        </Text>
                                                        {event.type ===
                                                            'limits_adjusted' &&
                                                        expiry ? (
                                                            <Text size='xs'>
                                                                Expiry:{' '}
                                                                {previousExpiry
                                                                    ? `${formatDateTime(previousExpiry)} → `
                                                                    : ''}
                                                                {formatDateTime(expiry)}
                                                                {remaining !== null
                                                                    ? ` · Balance set to ${formatSeconds(remaining)}`
                                                                    : ''}
                                                            </Text>
                                                        ) : null}
                                                        {event.type ===
                                                            'session_timeout_adjusted' &&
                                                        timeout !== null ? (
                                                            <Text size='xs'>
                                                                Session timeout set to{' '}
                                                                {formatSeconds(timeout)}
                                                            </Text>
                                                        ) : null}
                                                    </Stack>
                                                    <Text
                                                        size='xs'
                                                        c='dimmed'
                                                        ta='right'
                                                    >
                                                        {formatDateTime(
                                                            event.createdAt,
                                                        )}
                                                    </Text>
                                                </Group>
                                            </Card>
                                        );
                                    })}
                                </Stack>
                            )}
                        </>
                    ) : null}
                </Stack>
            )}
        </Drawer>
    );
}
