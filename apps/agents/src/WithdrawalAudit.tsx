import { Alert, Badge, Drawer, Group, Stack, Text, Title } from '@mantine/core';
import { dateTime, statusColor, type WithdrawalRow } from './AccountingViews';
import { money } from './money';
import { maskedBankAccount, maskedPhone } from './lib/maskedPhone';
import { MdAccountBalance } from 'react-icons/md';

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
    onClose,
}: {
    withdrawal: WithdrawalRow;
    events: AuditEvent[];
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
            <WithdrawalAuditContent
                withdrawal={withdrawal}
                events={events}
            />
        </Drawer>
    );
}

export function WithdrawalAuditContent({
    withdrawal,
    events,
    entryId,
    compact = false,
}: {
    withdrawal: WithdrawalRow;
    events: AuditEvent[];
    entryId?: string;
    compact?: boolean;
}) {
    return (
        <Stack
            gap={compact ? 'sm' : 'lg'}
            w={{ base: '100%', sm: compact ? '50%' : '100%' }}
        >
            <Group justify='space-between'>
                {compact ? (
                    <Title order={4} size='sm'>
                        Withdrawal details
                    </Title>
                ) : (
                    <Title order={3} className='money'>
                        {money(withdrawal.amount, withdrawal.currency)}
                    </Title>
                )}
                <Badge color={statusColor(withdrawal.status)} variant='filled'>
                    {withdrawal.status}
                </Badge>
            </Group>
            {!compact && (
                <Text size='sm'>
                    Requested {dateTime(withdrawal.createdAt)}
                </Text>
            )}
            {!compact && withdrawal.updatedAt && (
                <Text size='sm'>
                    Last updated {dateTime(withdrawal.updatedAt)}
                </Text>
            )}
            {withdrawal.reference && (
                <div>
                    <Text size='sm' fw={600}>
                        Reference
                    </Text>
                    <Text size='sm' style={{ overflowWrap: 'anywhere' }}>
                        {withdrawal.reference}
                    </Text>
                </div>
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
            {withdrawal.payout && (
                <div>
                    <Text size='sm' fw={600}>
                        Destination
                    </Text>
                    <Group justify='space-between' gap='md' wrap='nowrap'>
                        <Text size='sm' style={{ overflowWrap: 'anywhere' }}>
                            {withdrawal.payout.method === 'mpesa'
                                ? maskedPhone(withdrawal.payout.destination)
                                : maskedBankAccount(withdrawal.payout.destination)}
                        </Text>
                        {withdrawal.payout.method === 'mpesa' ? (
                            <img
                                src='/mpesa.png'
                                alt='M-Pesa'
                                width={56}
                                height={24}
                                style={{ objectFit: 'contain', flexShrink: 0 }}
                            />
                        ) : (
                            <MdAccountBalance size={20} aria-label='Bank' role='img' style={{ flexShrink: 0 }} />
                        )}
                    </Group>
                </div>
            )}
            {!compact && (
                <Alert color='blue' role='note'>
                    This portal does not transfer money. Approval only
                    authorizes manual processing. A paid entry records an
                    external payment supplied by your operator.
                </Alert>
            )}
            <Title order={4} size='sm'>
                Request history
            </Title>
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
                    {event.reference &&
                        event.reference !== withdrawal.reference && (
                            <Text
                                size='sm'
                                style={{ overflowWrap: 'anywhere' }}
                            >
                                Reference: {event.reference}
                            </Text>
                        )}
                </Stack>
            ))}
            <Text size='xs' c='dimmed' style={{ overflowWrap: 'anywhere' }}>
                Withdrawal: {withdrawal.id}
                {entryId && ` | Entry: ${entryId}`}
            </Text>
        </Stack>
    );
}
