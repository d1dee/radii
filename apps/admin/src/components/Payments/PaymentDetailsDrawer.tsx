import {
    Badge,
    Center,
    Code,
    Divider,
    Drawer,
    Grid,
    Group,
    Loader,
    Stack,
    Text,
    Timeline,
    Title,
} from '@mantine/core';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

import {
    getAdminPayment,
    type AdminPaymentDetail,
    type AdminPaymentEvent,
    type PackagePaymentStatus,
} from '@/lib/api';
import { formatDateTime, formatMoney } from '@/lib/format';

const STATUS_BADGE: Record<
    PackagePaymentStatus,
    { color: string; label: string }
> = {
    paid: { color: 'green', label: 'Paid' },
    pending: { color: 'orange', label: 'Pending' },
    failed: { color: 'red', label: 'Failed' },
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

function eventTitle(event: AdminPaymentEvent) {
    return event.eventType
        .split('_')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

function PaymentEvent({ event }: { event: AdminPaymentEvent }) {
    const isCallback = event.eventType.includes('callback');

    return (
        <Timeline.Item
            color={isCallback ? 'blue' : 'gray'}
            title={
                <Group gap='xs'>
                    <Text size='sm' fw={600}>
                        {eventTitle(event)}
                    </Text>
                    {isCallback ? (
                        <Badge size='xs' variant='light'>
                            Callback
                        </Badge>
                    ) : null}
                </Group>
            }
        >
            <Stack gap={4} mt={4}>
                {event.message ? (
                    <Text size='sm'>{event.message}</Text>
                ) : null}
                <Group gap='lg'>
                    {event.resultCode ? (
                        <Text size='xs' c='dimmed'>
                            Result code: {event.resultCode}
                        </Text>
                    ) : null}
                    {event.transactionStatus ? (
                        <Text size='xs' c='dimmed'>
                            Provider status: {event.transactionStatus}
                        </Text>
                    ) : null}
                    {event.amount !== null ? (
                        <Text size='xs' c='dimmed'>
                            Amount: {formatMoney(event.amount)}
                        </Text>
                    ) : null}
                </Group>
                {event.receipt ? (
                    <Text size='xs' c='dimmed'>
                        Receipt: <Code>{event.receipt}</Code>
                    </Text>
                ) : null}
                {event.providerRequestId ? (
                    <Text size='xs' c='dimmed'>
                        Request ID: <Code>{event.providerRequestId}</Code>
                    </Text>
                ) : null}
                {event.providerConversationId ? (
                    <Text size='xs' c='dimmed'>
                        Conversation ID:{' '}
                        <Code>{event.providerConversationId}</Code>
                    </Text>
                ) : null}
                {event.transactionDate ? (
                    <Text size='xs' c='dimmed'>
                        Provider time: {event.transactionDate}
                    </Text>
                ) : null}
                <Text size='xs' c='dimmed'>
                    Recorded {formatDateTime(event.createdAt)} via {event.provider}
                </Text>
            </Stack>
        </Timeline.Item>
    );
}

export function PaymentDetailsDrawer({
    paymentId,
    onClose,
}: {
    paymentId: string | null;
    onClose: () => void;
}) {
    const [payment, setPayment] = useState<AdminPaymentDetail | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!paymentId) return;

        let ignore = false;
        setPayment(null);
        setError(null);

        void getAdminPayment(paymentId).then((result) => {
            if (ignore) return;
            if (!result.success) {
                setError(result.message);
                return;
            }
            if (!result.data) {
                setError('Failed to load payment details');
                return;
            }
            setPayment(result.data);
        });

        return () => {
            ignore = true;
        };
    }, [paymentId]);

    const statusBadge = payment ? STATUS_BADGE[payment.status] : null;

    return (
        <Drawer
            opened={paymentId !== null}
            onClose={onClose}
            position='right'
            size='xl'
            title={<Title order={4}>Payment details</Title>}
        >
            {error ? (
                <Text c='red'>{error}</Text>
            ) : !payment || !statusBadge ? (
                <Center py='xl'>
                    <Loader />
                </Center>
            ) : (
                <Stack gap='lg'>
                    <Group gap='xs'>
                        <Badge color={statusBadge.color} variant='light'>
                            {statusBadge.label}
                        </Badge>
                        {payment.packageType ? (
                            <Badge color='grape' variant='light'>
                                {payment.packageType.toUpperCase()}
                            </Badge>
                        ) : null}
                        {payment.provider ? (
                            <Badge variant='outline'>{payment.provider}</Badge>
                        ) : null}
                    </Group>

                    <Grid>
                        <Grid.Col span={12}>
                            <DetailItem
                                label='Payment ID'
                                value={<Code>{payment.id}</Code>}
                            />
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                            <DetailItem
                                label='Customer'
                                value={payment.userName ?? 'Unnamed customer'}
                            />
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                            <DetailItem
                                label='Phone number'
                                value={payment.phoneNumber}
                            />
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                            <DetailItem
                                label='Package'
                                value={payment.packageTitle}
                            />
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                            <DetailItem
                                label='NAS device'
                                value={payment.nasDeviceName}
                            />
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                            <DetailItem
                                label='Amount'
                                value={formatMoney(payment.amount)}
                            />
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                            <DetailItem
                                label='Created'
                                value={formatDateTime(payment.createdAt)}
                            />
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                            <DetailItem
                                label='Last updated'
                                value={formatDateTime(payment.updatedAt)}
                            />
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                            <DetailItem
                                label='Transaction status'
                                value={payment.transactionStatus ?? 'Not created'}
                            />
                        </Grid.Col>
                        {payment.description ? (
                            <Grid.Col span={12}>
                                <DetailItem
                                    label='Description'
                                    value={payment.description}
                                />
                            </Grid.Col>
                        ) : null}
                    </Grid>

                    <Divider label='Provider references' labelPosition='left' />

                    <Grid>
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                            <DetailItem
                                label='Receipt / transaction ID'
                                value={
                                    payment.providerTransactionId ? (
                                        <Code>{payment.providerTransactionId}</Code>
                                    ) : (
                                        'Not available'
                                    )
                                }
                            />
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, sm: 6 }}>
                            <DetailItem
                                label='Checkout reference'
                                value={
                                    payment.providerReference ? (
                                        <Code>{payment.providerReference}</Code>
                                    ) : (
                                        'Not available'
                                    )
                                }
                            />
                        </Grid.Col>
                    </Grid>

                    <Divider label='Payment events' labelPosition='left' />

                    <Text size='xs' c='dimmed'>
                        Raw callback payloads and customer-sensitive provider
                        fields are hidden.
                    </Text>
                    {payment.events.length === 0 ? (
                        <Text c='dimmed'>No provider events recorded.</Text>
                    ) : (
                        <Timeline active={payment.events.length} bulletSize={18}>
                            {payment.events.map((event) => (
                                <PaymentEvent key={event.id} event={event} />
                            ))}
                        </Timeline>
                    )}
                </Stack>
            )}
        </Drawer>
    );
}
