import {
    Alert,
    Button,
    Center,
    Loader,
    Modal,
    Paper,
    Stack,
    Text,
} from '@mantine/core';
import { useEffect, useState } from 'react';
import { getWithdrawal, type WithdrawalDetail } from '@/lib/accountingApi';
import { accountingMoney } from '@/lib/accountingMoney';
import { formatDateTime } from '@/lib/format';

export function WithdrawalAudit({
    agentId,
    withdrawalId,
    onClose,
}: {
    agentId: string;
    withdrawalId: string;
    onClose: () => void;
}) {
    const [data, setData] = useState<WithdrawalDetail | null>(null);
    const [error, setError] = useState('');
    const [revision, setRevision] = useState(0);
    useEffect(() => {
        let cancelled = false;
        setData(null);
        setError('');
        void getWithdrawal(agentId, withdrawalId).then((result) => {
            if (cancelled) return;
            if (result.success && result.data) setData(result.data);
            else
                setError(
                    result.success
                        ? 'No withdrawal history returned.'
                        : result.message,
                );
        });
        return () => {
            cancelled = true;
        };
    }, [agentId, withdrawalId, revision]);
    return (
        <Modal
            opened
            onClose={onClose}
            title='Withdrawal audit history'
            size='lg'
        >
            {error ? (
                <Alert color='red' role='alert'>
                    {error}
                    <Button
                        variant='subtle'
                        onClick={() => setRevision((value) => value + 1)}
                    >
                        Retry
                    </Button>
                </Alert>
            ) : !data ? (
                <Center py='xl'>
                    <Loader />
                </Center>
            ) : (
                <Stack>
                    <Text fw={600}>
                        {accountingMoney(
                            data.withdrawal.amount,
                            data.withdrawal.currency,
                        )}
                    </Text>
                    <Text size='xs' style={{ overflowWrap: 'anywhere' }}>
                        Request: {data.withdrawal.id}
                    </Text>
                    {data.withdrawal.note && (
                        <Text size='sm'>{data.withdrawal.note}</Text>
                    )}
                    {data.events.length === 0 && (
                        <Text c='dimmed'>No audit events returned.</Text>
                    )}
                    {data.events.map((event) => (
                        <Paper withBorder p='sm' key={event.id}>
                            <Text fw={600}>
                                {event.status} ·{' '}
                                {formatDateTime(event.createdAt)}
                            </Text>
                            {event.actorAdminId && (
                                <Text size='xs'>
                                    Admin: {event.actorAdminId}
                                </Text>
                            )}
                            {event.reason && (
                                <Text size='sm'>Reason: {event.reason}</Text>
                            )}
                            {event.reference && (
                                <Text size='sm'>
                                    Reference: {event.reference}
                                </Text>
                            )}
                            {event.evidence && (
                                <Text
                                    size='sm'
                                    style={{
                                        whiteSpace: 'pre-wrap',
                                        overflowWrap: 'anywhere',
                                    }}
                                >
                                    Evidence: {event.evidence}
                                </Text>
                            )}
                        </Paper>
                    ))}
                </Stack>
            )}
        </Modal>
    );
}
