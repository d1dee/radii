import { Alert, Badge, Drawer, Group, Stack, Text, Title } from '@mantine/core';
import { dateTime, statusColor, type WithdrawalRow } from './AccountingViews';
import { money } from './money';

export type AuditEvent = {
    id: string;
    status: string;
    actorType: 'ADMIN' | 'AGENT';
    createdAt: string;
    reason: string | null;
    reference: string | null;
};
export function WithdrawalAuditView({
    withdrawal,
    events,
    destination,
    onClose,
}: {
    withdrawal: WithdrawalRow;
    events: AuditEvent[];
    destination?: string;
    onClose: () => void;
}) {
    return (
        <Drawer
            opened
            onClose={onClose}
            position='right'
            size='lg'
            title='Withdrawal details and audit'
            closeButtonProps={{ 'aria-label': 'Close withdrawal audit' }}
        >
            <Stack gap='lg'>
                <Group justify='space-between'>
                    <Title order={3} className='money'>
                        {money(withdrawal.amount, withdrawal.currency)}
                    </Title>
                    <Badge
                        color={statusColor(withdrawal.status)}
                        variant='filled'
                    >
                        {withdrawal.status}
                    </Badge>
                </Group>
                <Text size='sm'>
                    Requested {dateTime(withdrawal.createdAt)}
                </Text>
                <Text size='xs' c='dimmed' style={{ overflowWrap: 'anywhere' }}>
                    Withdrawal ID: {withdrawal.id}
                </Text>
                {withdrawal.updatedAt && (
                    <Text size='sm'>
                        Last updated {dateTime(withdrawal.updatedAt)}
                    </Text>
                )}
                {withdrawal.reference && (
                    <Text size='sm' style={{ overflowWrap: 'anywhere' }}>
                        External payment reference: {withdrawal.reference}
                    </Text>
                )}
                {withdrawal.note && (
                    <div>
                        <Text size='sm' fw={600}>
                            Your note
                        </Text>
                        <Text
                            size='sm'
                            style={{
                                overflowWrap: 'anywhere',
                                whiteSpace: 'pre-wrap',
                            }}
                        >
                            {withdrawal.note}
                        </Text>
                    </div>
                )}
                {destination && (
                    <div>
                        <Text size='sm' fw={600}>
                            Destination at request time
                        </Text>
                        <Text size='sm' style={{ overflowWrap: 'anywhere' }}>
                            {destination}
                        </Text>
                    </div>
                )}
                <Alert color='blue' role='note'>
                    This portal does not transfer money. Approval only
                    authorizes manual processing. A paid entry records an
                    external payment supplied by your operator.
                </Alert>
                <Title order={4}>Request history</Title>
                {!events.length && (
                    <Text c='dimmed' size='sm'>
                        No audit events are available.
                    </Text>
                )}
                {events.map((event) => (
                    <Stack key={event.id} gap={6} className='audit-item'>
                        <Group justify='space-between'>
                            <Badge
                                color={statusColor(event.status)}
                                variant='light'
                            >
                                {event.status}
                            </Badge>
                            <Text size='xs' c='dimmed'>
                                {dateTime(event.createdAt)}
                            </Text>
                        </Group>
                        <Text size='xs' c='dimmed'>
                            {event.actorType === 'ADMIN' ? 'Operator' : 'Agent'}
                        </Text>
                        {event.reason && (
                            <Text
                                size='sm'
                                style={{
                                    whiteSpace: 'pre-wrap',
                                    overflowWrap: 'anywhere',
                                }}
                            >
                                {event.reason}
                            </Text>
                        )}
                        {event.reference && (
                            <Text
                                size='sm'
                                style={{ overflowWrap: 'anywhere' }}
                            >
                                External reference: {event.reference}
                            </Text>
                        )}
                    </Stack>
                ))}
            </Stack>
        </Drawer>
    );
}
