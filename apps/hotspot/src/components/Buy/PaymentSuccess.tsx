import { Button, Stack, Text } from '@mantine/core';
import type { OrderResult } from '../../lib/api.ts';

import { IoMdDoneAll } from 'react-icons/io';

export function PaymentSuccess({
    paymentData,
    onDone,
}: {
    paymentData: OrderResult | null;
    onDone: () => void;
}) {
    return (
        <Stack align='center' gap='lg' p='md' ta='center'>
            <svg
                xmlns='http://www.w3.org/2000/svg'
                width='96'
                height='96'
                viewBox='0 0 24 24'
                fill='none'
                stroke='var(--mantine-color-grape-5)'
                strokeWidth='2'
                strokeLinecap='round'
                strokeLinejoin='round'
            >
                <path d='M5 13l4 4L19 7' />
            </svg>

            {paymentData ? (
                <Stack align='center' gap='xs'>
                    <Text size='lg' fw={600} c='green'>
                        Payment of Kes: {paymentData.amount} was Successful.
                    </Text>
                    <Text size='sm' c='gray.6'>
                        Payment ID: {paymentData.paymentId}
                    </Text>
                    <Text size='sm'>
                        Please wait a few seconds for the system to activate
                        your package.
                    </Text>
                </Stack>
            ) : (
                <Stack align='center' gap='xs'>
                    <Text size='xl' fw={600} c='gray.8'>
                        Error...
                    </Text>
                    <Text size='sm' c='gray.6'>
                        Unknown error occurred while processing your payment.
                    </Text>
                </Stack>
            )}

            <Button
                variant='outline'
                color='green'
                fullWidth
                onClick={onDone}
                leftSection={<IoMdDoneAll />}
            >
                Done
            </Button>
        </Stack>
    );
}
