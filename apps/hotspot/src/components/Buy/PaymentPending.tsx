import { Loader, Stack, Text } from '@mantine/core';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { OrderResult } from '../../lib/api.ts';
import { getPaymentStatus } from '../../lib/api.ts';
import { mutationLogger } from '../../lib/logging.ts';
import type { FlowStatus } from './PaymentFlow.tsx';

export function PendingPayment({
    orderId,
    isFree,
    onStatusChange,
    onError,
}: {
    orderId: string;
    isFree: boolean;
    onStatusChange: (status: FlowStatus, data: OrderResult | null) => void;
    onError: (message: string) => void;
}) {
    const [tick, setTick] = useState(0);
    const [connectionWarning, setConnectionWarning] = useState(false);
    const tickRef = useRef(0);
    const paidWithoutActivationRef = useRef(0);
    const handlePoll = useEffectEvent(async () => {
        const result = await getPaymentStatus(orderId);
        if (!result.success) {
            setConnectionWarning(true);
            return true;
        }
        setConnectionWarning(false);

        const { status } = result.data!;
        if (status === 'paid' && result.data!.activation) {
            onStatusChange('success', result.data!);
            return false;
        }
        if (status === 'paid') {
            paidWithoutActivationRef.current++;
            if (paidWithoutActivationRef.current >= 15) {
                onStatusChange('success', result.data!);
                return false;
            }
            return true;
        }
        if (status === 'failed') {
            onError(result.data!.message || 'Payment failed. Please try again.');
            return false;
        }
        return true;
    });

    useEffect(() => {
        const tickInterval = setInterval(() => {
            tickRef.current++;
            setTick(tickRef.current);
        }, 500);

        let cancelled = false;
        let pollTimer: ReturnType<typeof setTimeout> | undefined;
        const poll = async () => {
            try {
                const pending = await handlePoll();
                if (!cancelled && pending) pollTimer = setTimeout(poll, 2_000);
            } catch (error) {
                mutationLogger.warning('Unexpected payment polling failure.', {
                    operation: 'poll-payment',
                    errorName:
                        error instanceof Error ? error.name : 'UnknownError',
                });
                if (!cancelled) {
                    setConnectionWarning(true);
                    pollTimer = setTimeout(poll, 2_000);
                }
            }
        };
        void poll();

        return () => {
            cancelled = true;
            clearInterval(tickInterval);
            clearTimeout(pollTimer);
        };
    }, [orderId]);

    return (
        <Stack align='center' gap='lg' p='md'>
            <Text size='xl' fw={600} c='gray.8'>
                {isFree ? 'Activating Package' : 'Processing Payment'}
                {'.'.repeat((tick % 3) + 1)}
            </Text>

            <Loader size='xl' color='grape' />

            <Stack align='center' gap='xs' ta='center'>
                <Text size='sm' c='red.4'>
                    Please do not close this window while we{' '}
                    {isFree ? 'activate your package' : 'process your payment'}.
                </Text>
                <Text size='sm' c='gray.6'>
                    {isFree
                        ? 'This may take a few seconds.'
                        : 'Payment confirmation can take a minute. Do not submit another payment while we wait.'}
                </Text>
                {connectionWarning ? (
                    <Text size='sm' c='orange.7' role='status'>
                        Connection interrupted. We are retrying the status check
                        {isFree ? ' for your activation.' : ' for your existing payment.'}
                    </Text>
                ) : null}
            </Stack>
        </Stack>
    );
}
