import { Button, Card, Paper, Stack, Text, TextInput } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';

import { schemaResolver, useForm } from '@mantine/form';
import {
    paymentTransactionCodeSchema,
    type ActivationRedirect,
    type AdminContactsSettings,
    type PaymentClaimActivationDetails,
} from '@radii/shared';
import { AdminContacts } from '../../components/AdminContacts.tsx';
import {
    currentLoginRequestId,
    getPaymentReceiptStatus,
    verifyPaymentReceipt,
} from '../../lib/api.ts';
import { mutationLogger } from '../../lib/logging.ts';
import { refreshHotspotQuota } from '../../lib/store.ts';

interface Props {
    adminContacts: AdminContactsSettings;
}

export function HavingIssues({ adminContacts }: Props) {
    const [message, setMessage] = useState<
        { success?: boolean; message: string } | undefined
    >(undefined);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const generationRef = useRef(0);
    const checkingRef = useRef(false);
    const [checking, setChecking] = useState(false);
    const activationFormRef = useRef<HTMLFormElement>(null);
    const [activationDetails, setActivationDetails] =
        useState<PaymentClaimActivationDetails | null>(null);
    const [activation, setActivation] = useState<ActivationRedirect | null>(
        null,
    );

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
        if (checkingRef.current) return;
        stopPolling();
        const generation = ++generationRef.current;

        const transactionId = values.transactionCode;
        const loginRequestId = currentLoginRequestId();
        if (!transactionId) {
            setMessage({
                success: false,
                message:
                    'Enter the M-Pesa receipt number (e.g. NEF61H8J60), or paste the whole M-Pesa message.',
            });
            return;
        }

        checkingRef.current = true;
        setChecking(true);
        setActivation(null);
        setActivationDetails(null);
        setMessage({ message: 'Checking your payment and package activation...' });

        // Initiate verification once, then read the stored callback and activation result.
        const pollOnce = async (initiate = false): Promise<boolean> => {
            try {
                const res = await (initiate ? verifyPaymentReceipt : getPaymentReceiptStatus)(
                    transactionId,
                    loginRequestId,
                );
                if (generationRef.current !== generation) return false;
                if (!res.success) {
                    setMessage({
                        success: false,
                        message:
                            res.message || 'Transaction verification failed',
                    });
                    return false;
                }
                if (!res.data) {
                    setMessage({
                        success: false,
                        message: 'Could not load the payment verification result.',
                    });
                    return false;
                }
                const {
                    status,
                    message: detail,
                    claimOutcome,
                    activationDetails: details,
                } = res.data;
                if (
                    status === 'pending' ||
                    (status === 'paid' &&
                        (claimOutcome === 'activation_pending' || !details))
                ) {
                    setMessage({
                        message: detail || 'Finishing payment verification and package activation...',
                    });
                    return true;
                }
                setMessage({
                    success: status === 'paid',
                    message: detail || status,
                });
                if (status === 'paid' && details) {
                    setActivationDetails(details);
                    setActivation(
                        details.active ? res.data.activation ?? null : null,
                    );
                    void refreshHotspotQuota(loginRequestId);
                }
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
                        success: false,
                        message: 'Could not verify the transaction. Try again.',
                    });
                }
                return false;
            }
        };

        const pending = await pollOnce(true);
        if (generationRef.current !== generation) return;
        if (pending) {
            let attempts = 1;
            const poll = async () => {
                attempts++;
                const stillPending = await pollOnce();
                if (generationRef.current !== generation) return;
                if (!stillPending) {
                    stopPolling();
                    checkingRef.current = false;
                    setChecking(false);
                } else if (attempts >= 60) {
                    stopPolling();
                    checkingRef.current = false;
                    setChecking(false);
                    setMessage({
                        message:
                            'Payment verification or package activation is taking longer than usual. Check again shortly or contact the admin.',
                    });
                } else {
                    timerRef.current = setTimeout(poll, 5_000);
                }
            };
            timerRef.current = setTimeout(poll, 5_000);
        } else {
            checkingRef.current = false;
            setChecking(false);
        }
    };

    const receiptInputProps = form.getInputProps('transactionCode');

    return (
        <Paper shadow='xl' radius='lg' p='lg' withBorder>
            <Stack gap='md'>
                <Text size='lg' fw={600}>
                    Having Issues?
                </Text>

                <Card radius='lg' p='md' withBorder>
                    <Stack gap='sm'>
                        <Text fw={500}>Verify Transaction:</Text>
                        <Text size='sm' c='dimmed'>
                            Recover an unactivated package, or check when your
                            payment activated it.
                        </Text>

                        <form onSubmit={form.onSubmit(verifyTransaction)}>
                            <Stack gap='xs'>
                                <TextInput
                                    placeholder='Enter transaction ID or paste your M-pesa message here'
                                    name='transactionCode'
                                    label='M-Pesa receipt or payment message'
                                    disabled={checking}
                                    {...receiptInputProps}
                                    onChange={(event) => {
                                        receiptInputProps.onChange(event);
                                        setMessage(undefined);
                                        setActivationDetails(null);
                                        setActivation(null);
                                    }}
                                />
                                <Button type='submit' loading={checking}>
                                    Verify
                                </Button>
                                {checking ? (
                                    <Button
                                        type='button'
                                        variant='subtle'
                                        onClick={() => {
                                            generationRef.current++;
                                            stopPolling();
                                            checkingRef.current = false;
                                            setChecking(false);
                                            setMessage(undefined);
                                        }}
                                    >
                                        Cancel check
                                    </Button>
                                ) : null}

                                {message ? (
                                    <Text
                                        size='sm'
                                        c={message.success === undefined
                                            ? 'dimmed'
                                            : message.success ? 'green' : 'red'}
                                        role='status'
                                    >
                                        {message.message}
                                    </Text>
                                ) : null}
                                {activationDetails ? (
                                    <Stack gap={4} mt='sm'>
                                        <Text fw={600}>
                                            {activationDetails.packageTitle}
                                        </Text>
                                        <Text size='sm'>
                                            Network: {activationDetails.nasDeviceName}
                                        </Text>
                                        <Text size='sm'>
                                            Activated: {new Date(activationDetails.activatedAt).toLocaleString()}
                                        </Text>
                                        <Text size='sm'>
                                            {activationDetails.noExpiry ? 'Validity ends' : 'Expires'}:{' '}
                                            {activationDetails.expireAt
                                                ? new Date(activationDetails.expireAt).toLocaleString()
                                                : 'No expiry'}
                                        </Text>
                                        <Text
                                            size='sm'
                                            c={activationDetails.active ? 'green' : 'dimmed'}
                                        >
                                            {activationDetails.active
                                                ? 'Package is active.'
                                                : 'This activation is no longer active. Claiming the receipt does not renew it.'}
                                        </Text>
                                        {activation ? (
                                            <Button
                                                type='button'
                                                mt='xs'
                                                onClick={() => activationFormRef.current?.submit()}
                                            >
                                                Connect with this package
                                            </Button>
                                        ) : null}
                                    </Stack>
                                ) : null}
                            </Stack>
                        </form>
                    </Stack>
                </Card>

                <AdminContacts adminContacts={adminContacts} />

                {activation ? (
                    <form
                        ref={activationFormRef}
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
                    </form>
                ) : null}
            </Stack>
        </Paper>
    );
}
