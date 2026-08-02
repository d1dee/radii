import { useEffect, useRef, useState } from 'react';
import { Button, Loader, Stack, Text } from '@mantine/core';
import type { FlowStatus, PaymentXHR } from '../paymentTypes.ts';

import { IoMdRefresh } from 'react-icons/io';

export function PendingPayment({
    orderId: _orderId,
    onStatusChange: _onStatusChange,
    onRetry,
}: {
    orderId: string;
    onStatusChange: (status: FlowStatus, xhr: PaymentXHR | undefined) => void;
    onRetry: () => void;
}) {
    const [tick, setTick] = useState(0);

    const tickRef = useRef(0);

    useEffect(() => {
        const interval = setInterval(() => {
            tickRef.current++;
            setTick(tickRef.current);
        }, 500);

        return () => clearInterval(interval);
    }, []);

    return (
        <Stack align="center" gap="lg" p="md">
            <Text size="xl" fw={600} c="gray.8">
                Processing Payment{'.'.repeat((tick % 3) + 1)}
            </Text>

            <Loader size="xl" color="grape" />

            <Stack align="center" gap="xs" ta="center">
                <Text size="sm" c="red.4">
                    Please do not close this window while we process your
                    payment.
                </Text>
                <Text size="sm" c="gray.6">
                    This may take a few seconds.
                </Text>
            </Stack>

            <Button
                variant="outline"
                fullWidth
                onClick={onRetry}
                leftSection={<IoMdRefresh />}
            >
                Retry
            </Button>
        </Stack>
    );
}
