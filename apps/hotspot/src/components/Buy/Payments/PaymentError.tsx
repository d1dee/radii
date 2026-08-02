import { Button, Stack, Text } from '@mantine/core';
import type { PaymentXHR } from '../paymentTypes.ts';

import { IoMdRefresh } from 'react-icons/io';

export function PaymentError({
    xhr,
    onRetry,
}: {
    xhr: PaymentXHR | undefined;
    onRetry: () => void;
}) {
    return (
        <Stack align="center" gap="lg" p="md" ta="center">
            <svg
                xmlns="http://www.w3.org/2000/svg"
                width="96"
                height="96"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--mantine-color-red-6)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            >
                <path d="M6 18L18 6M6 6l12 12" />
            </svg>

            <Text size="sm" c="red" ta="center">
                {(xhr && xhr.success === false ? xhr.message : undefined) ||
                    'An error occured while handling your payment. Please try again.'}
            </Text>

            <Button
                variant="outline"
                color="red"
                fullWidth
                onClick={onRetry}
                leftSection={<IoMdRefresh />}
            >
                Retry
            </Button>
        </Stack>
    );
}
