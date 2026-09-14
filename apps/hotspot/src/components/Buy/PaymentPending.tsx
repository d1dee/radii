import { Button, Loader, Stack, Text } from '@mantine/core';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { OrderResult } from '../../lib/api.ts';
import { getPaymentStatus } from '../../lib/api.ts';
import type { FlowStatus } from './PaymentFlow.tsx';

import { IoMdRefresh } from 'react-icons/io';

export function PendingPayment({
    orderId,
    onStatusChange,
    onError,
    onRetry,
}: {
    orderId: string;
    onStatusChange: (status: FlowStatus, data: OrderResult | null) => void;
    onError: (message: string) => void;
    onRetry: () => void;
}) {
    const [tick, setTick] = useState(0);
    const tickRef = useRef(0);
    const handlePoll = useEffectEvent(async () => {
        const result = await getPaymentStatus(orderId);
        if (!result.success) {
            onError(result.message || 'Could not check payment status.');
            return false;
        }

        const { status } = result.data!;
        if (status === 'paid') {
            onStatusChange('success', result.data!);
            return false;
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
            } catch {
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

            <Button
                variant='outline'
                fullWidth
                onClick={onRetry}
                leftSection={<IoMdRefresh />}
            >
                Retry
            </Button>
        </Stack>
    );
}
