import { Button, Card, Paper, Stack, Text, TextInput } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';

import { schemaResolver, useForm } from '@mantine/form';
import {
    paymentTransactionCodeSchema,
    type AdminContactsSettings,
} from '@radii/shared';
import { verifyPaymentReceipt } from '../../lib/api.ts';
import { mutationLogger } from '../../lib/logging.ts';
import { AdminContacts } from '../AdminContacts.tsx';

interface Props {
    adminContacts: AdminContactsSettings;
}

export function HavingIssues({ adminContacts }: Props) {
    const [message, setMessage] = useState<
        { success?: true; message: string } | undefined
    >(undefined);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const generationRef = useRef(0);

    const form = useForm({
        mode: 'controlled',
        initialValues: { transactionCode: '' },
        validate: schemaResolver(paymentTransactionCodeSchema, { sync: true }),
        transformValues: paymentTransactionCodeSchema.parse,
    });
    const stopPolling = () => {
        if (!timerRef.current) return;
        clearTimeout(timerRef.current);
        timerRef.current = null;
    };

    useEffect(
        () => () => {
            generationRef.current++;
            stopPolling();
        },
        [],
    );

    const verifyTransaction = async (values: typeof form.values) => {
        stopPolling();
        const generation = ++generationRef.current;

        const transactionId = values.transactionCode;
        if (!transactionId) {
            setMessage({
                message:
                    'Enter the M-Pesa receipt number (e.g. NEF61H8J60), or paste the whole M-Pesa message.',
            });
            return;
        }

        setMessage({ success: true, message: 'Processing...' });

        // The provider may confirm asynchronously (status callback), so repost
        // the receipt until the payment leaves the pending state; the service
        // deduplicates in-flight verifications server-side.
        const pollOnce = async (): Promise<boolean> => {
            try {
                const res = await verifyPaymentReceipt(values.transactionCode);
                if (generationRef.current !== generation) return false;
                if (!res.success) {
                    setMessage({
                        message:
                            res.message || 'Transaction verification failed',
                    });
                    return false;
                }
                const { status, message: detail } = res.data!;
                if (status === 'pending') {
                    setMessage({
                        success: true,
                        message: detail || 'Processing...',
                    });
                    return true;
                }
                setMessage({
                    success: status === 'paid' ? true : undefined,
                    message: detail || status,
                });
                return false;
            } catch (error) {
                mutationLogger.warning(
                    'Unexpected payment verification failure.',
                    {
                        operation: 'verify-payment',
                        errorName:
                            error instanceof Error
                                ? error.name
                                : 'UnknownError',
                    },
                );
                if (generationRef.current === generation) {
                    setMessage({
                        message:
                            'Could not verify the transaction. Try again.',
                    });
                }
                return false;
            }
        };

        if (await pollOnce()) {
            let attempts = 1;
            const poll = async () => {
                attempts++;
                if (!(await pollOnce())) {
                    stopPolling();
                } else if (attempts >= 60) {
                    stopPolling();
                    setMessage({
                        success: true,
                        message:
                            'Verification is taking longer than usual. Your payment may still be confirmed automatically — check back shortly or contact the admin.',
                    });
                } else {
                    timerRef.current = setTimeout(poll, 3_000);
                }
            };
            timerRef.current = setTimeout(poll, 3_000);
        }
    };

    return (
        <Paper shadow='xl' radius='lg' p='lg' withBorder>
            <Stack gap='md'>
                <Text size='lg' fw={600}>
                    Having Issues?
                </Text>

                <Card radius='lg' p='md' withBorder>
                    <Stack gap='sm'>
                        <Text fw={500}>Verify Transaction:</Text>

                        <form onSubmit={form.onSubmit(verifyTransaction)}>
                            <Stack gap='xs'>
                                <TextInput
                                    placeholder='Enter transaction ID or paste your M-pesa message here'
                                    name='transactionCode'
                                    {...form.getInputProps('transactionCode')}
                                />
                                <Button type='submit'>Verify</Button>

                                {message ? (
                                    <Text
                                        size='sm'
                                        c={message.success ? 'green' : 'red'}
                                    >
                                        {message.message}
                                    </Text>
                                ) : null}
                            </Stack>
                        </form>
                    </Stack>
                </Card>

                <AdminContacts adminContacts={adminContacts} />
            </Stack>
        </Paper>
    );
}
