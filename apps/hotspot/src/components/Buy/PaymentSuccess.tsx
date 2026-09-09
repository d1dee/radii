import { Button, Loader, Stack, Text } from '@mantine/core';
import { useEffect, useRef } from 'react';
import type { OrderResult } from '../../lib/api.ts';

import { IoMdDoneAll } from 'react-icons/io';

export function PaymentSuccess({
    paymentData,
    onDone,
}: {
    paymentData: OrderResult | null;
    onDone: () => void;
}) {
    const formRef = useRef<HTMLFormElement>(null);
    const submitted = useRef(false);
    const activation = paymentData?.activation ?? null;

    // Final activation hop: re-submit the freshly issued hotspot credentials
    // to the NAS servlet login page ($(link-login-only), MikroTik hotspot
    // customisation flow). The router authenticates them against RADIUS,
    // applies the package limits and lets the client through.
    useEffect(() => {
        if (activation && !submitted.current && formRef.current) {
            submitted.current = true;
            formRef.current.submit();
        }
    }, [activation]);

    if (activation) {
        return (
            <Stack align='center' gap='lg' p='md' ta='center'>
                <Loader size='xl' color='grape' />
                <Text size='lg' fw={600} c='green'>
                    Payment of Kes: {paymentData?.amount} was Successful.
                </Text>
                <Text size='sm' c='gray.6'>
                    Connecting you to the internet&hellip;
                </Text>
                <form
                    ref={formRef}
                    action={activation.linkLoginOnly}
                    method='post'
                >
                    <input
                        type='hidden'
                        name='username'
                        value={activation.username}
                    />
                    <input
                        type='hidden'
                        name='password'
                        value={activation.password}
                    />
                    <input type='hidden' name='domain' value='' />
                    <input type='hidden' name='dst' value={activation.dst} />
                    <input type='hidden' name='popup' value='true' />
                    <noscript>
                        <Stack align='center' gap='sm'>
                            <Text size='sm'>JavaScript is disabled.</Text>
                            <Button
                                type='submit'
                                variant='outline'
                                color='green'
                            >
                                Connect Now
                            </Button>
                        </Stack>
                    </noscript>
                </form>
            </Stack>
        );
    }

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
