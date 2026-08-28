import { Button, Card, Paper, Stack, Text, TextInput } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';

import { schemaResolver, useForm } from '@mantine/form';
import { paymentTransactionCodeSchema } from '@radii/shared';
import { AdminContacts } from '../../components/AdminContacts.tsx';
import { verifyPaymentReceipt } from '../../lib/api.ts';

interface Props {
    adminContacts: { ADMIN_TEL: string; ADMIN_WHATSAPP: string };
}

export function HavingIssues({ adminContacts }: Props) {
    const [message, setMessage] = useState<
        { success?: true; message: string } | undefined
    >(undefined);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const form = useForm({
        mode: 'controlled',
        initialValues: { transactionCode: '' },
        validate: schemaResolver(paymentTransactionCodeSchema, { sync: true }),
        transformValues: paymentTransactionCodeSchema.parse,
    });
    const stopPolling = () => {
        if (!intervalRef.current) return;
        clearInterval(intervalRef.current);
        intervalRef.current = null;
    };

    useEffect(() => stopPolling, []);

    const verifyTransaction = async (values: typeof form.values) => {
        stopPolling();

        const transactionId = values.transactionCode;
        if (!transactionId) {
            setMessage({
                message:
                    'Enter the M-Pesa receipt number (e.g. NEF61H8J60), or paste the whole M-Pesa message.',
            });
            return;
        }

        setMessage({ success: true, message: 'Processing...' });
        /* 
        const pending = await getLatestPendingPayment();
        if (!pending.success || !pending.data) {
            setMessage({
                message: pending.success
                    ? 'No pending payment found. Buy a package first, then paste your receipt here.'
                    : pending.message ||
                      'Could not look up your pending payment',
            });
            return;
        }
        const paymentId = pending.data.paymentId; */

        // The provider may confirm asynchronously (status callback), so repost
        // the receipt until the payment leaves the pending state; the service
        // deduplicates in-flight verifications server-side.
        const pollOnce = async (): Promise<boolean> => {
            const res = await verifyPaymentReceipt(values.transactionCode);
            if (!res.success) {
                setMessage({
                    message: res.message || 'Transaction verification failed',
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
        };

        if (await pollOnce()) {
            let attempts = 1;
            intervalRef.current = setInterval(async () => {
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
                }
            }, 3e3);
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
