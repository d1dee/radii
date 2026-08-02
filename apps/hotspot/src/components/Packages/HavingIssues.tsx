import { useState } from 'react';
import { Button, Paper, Stack, Text, TextInput } from '@mantine/core';

import { AdminContacts } from '../../components/AdminContacts.tsx';

type VerifyResponse = {
    success: boolean;
    data?: { status?: string; message?: string };
    error?: string;
};

async function verifyTransactionRequest(
    transactionId: string,
): Promise<VerifyResponse | undefined> {
    try {
        const res = await fetch('/api/hotspot/verify-transaction', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transactionId }),
        });
        return (await res.json()) as VerifyResponse;
    } catch {
        return undefined;
    }
}

export function HavingIssues({
    adminContacts,
}: {
    adminContacts: { ADMIN_TEL: string; ADMIN_WHATSAPP: string };
}) {
    const [message, setMessage] = useState<
        | {
              success?: true;
              message: string;
              data?: Record<PropertyKey, unknown>;
          }
        | undefined
    >(undefined);
    const [value, setValue] = useState('');

    const verifyTransaction = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const transactionId = value.trim().split(/\s+/)[0];
        console.log('Transaction ID:', transactionId);

        const isValidTransactionId = /^[0-9A-Z]{10}$/i.test(transactionId);
        if (!isValidTransactionId) {
            setMessage({ message: 'Invalid transaction ID format' });
            return;
        } else {
            setMessage({ success: true, message: 'Processing...' });
        }

        const interval = setInterval(async () => {
            try {
                const res = await verifyTransactionRequest(transactionId);
                if (!res || res.success === false) {
                    clearInterval(interval);
                    setMessage({
                        message: res?.error || 'Transaction verification failed',
                    });
                } else {
                    const status =
                        res.data?.status || res.data?.message || 'pending';
                    if (status === 'pending') {
                        setMessage({ success: true, message: 'Processing...' });
                    } else {
                        clearInterval(interval);
                        setMessage({ success: true, message: status });
                    }
                }
            } catch (error) {
                console.error('Error verifying transaction:', error);
                setMessage({ message: 'Error verifying transaction.' });
            }
        }, 3e3);
    };

    return (
        <Stack gap="md" mt="md">
            <Paper shadow="xl" radius="lg" p="lg">
                <Stack gap="md">
                    <Text size="lg" fw={600}>
                        Having Issues?
                    </Text>

                    <Paper bg="grape.1" radius="lg" p="md">
                        <Stack gap="sm">
                            <Text fw={500}>Verify Transaction:</Text>

                            <form onSubmit={verifyTransaction}>
                                <Stack gap="xs">
                                    <TextInput
                                        placeholder="Enter transaction ID or paste your M-pesa message here"
                                        name="transactionMessage"
                                        value={value}
                                        onChange={(e) =>
                                            setValue(e.currentTarget.value)
                                        }
                                        error={
                                            message && !message.success
                                                ? message.message
                                                : undefined
                                        }
                                    />
                                    <Button type="submit">Verify</Button>

                                    {message ? (
                                        <Text
                                            size="sm"
                                            c={
                                                message.success
                                                    ? 'green'
                                                    : 'red'
                                            }
                                        >
                                            {message.message}
                                        </Text>
                                    ) : null}
                                </Stack>
                            </form>
                        </Stack>
                    </Paper>

                    <AdminContacts adminContacts={adminContacts} />
                </Stack>
            </Paper>
        </Stack>
    );
}
