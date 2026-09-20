import { Loader, Stack, Text } from '@mantine/core';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { OrderResult } from '../../lib/api.ts';
import { getPaymentStatus } from '../../lib/api.ts';
import { mutationLogger } from '../../lib/logging.ts';
import type { FlowStatus } from './PaymentFlow.tsx';

export function PendingPayment({
    orderId,
    onStatusChange,
    onError,
}: {
    orderId: string;
    onStatusChange: (status: FlowStatus, data: OrderResult | null) => void;
    onError: (message: string) => void;
}) {
    const [tick, setTick] = useState(0);
    const tickRef = useRef(0);
    const failedPollsRef = useRef(0);
    const paidWithoutActivationRef = useRef(0);
    const handlePoll = useEffectEvent(async () => {
        const result = await getPaymentStatus(orderId);
        if (!result.success) {
            failedPollsRef.current++;
            if (failedPollsRef.current >= 3) {
                onError(result.message || 'Could not check payment status.');
                return false;
            }
            return true;
        }
        failedPollsRef.current = 0;

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
            onError('Payment failed. Please try again.');
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
                if (!cancelled) onError('Could not reach the server. Try again.');
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
                Processing Payment{'.'.repeat((tick % 3) + 1)}
            </Text>

            <Loader size='xl' color='grape' />

            <Stack align='center' gap='xs' ta='center'>
                <Text size='sm' c='red.4'>
                    Please do not close this window while we process your
                    payment.
                </Text>
                <Text size='sm' c='gray.6'>
                    This may take a few seconds.
                </Text>
            </Stack>

        </Stack>
    );
}
