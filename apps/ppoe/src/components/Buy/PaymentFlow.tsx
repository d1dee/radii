import { Modal, Paper, Stack, Text, Title } from '@mantine/core';
import { useState } from 'react';
import type { OrderResult } from '../../lib/api.ts';
import { BuyForm } from './Form.tsx';
import { PaymentError } from './PaymentError.tsx';
import { PendingPayment } from './PaymentPending.tsx';
import { PaymentSuccess } from './PaymentSuccess.tsx';

export type FlowStatus = 'buy' | 'pending' | 'errored' | 'success';

const TITLES: Record<FlowStatus, { title: string; subtitle: string }> = {
    buy: {
        title: 'Top-Up',
        subtitle: 'Pay for your package securely with M-Pesa',
    },
    pending: {
        title: 'Processing Payment',
        subtitle: 'Please wait while we verify your transaction',
    },
    errored: {
        title: 'Payment Error',
        subtitle: 'Something went wrong with your payment',
    },
    success: {
        title: 'Payment Successful',
        subtitle: 'Your package has been activated',
    },
};

const FREE_TITLES: Record<FlowStatus, { title: string; subtitle: string }> = {
    buy: {
        title: 'Activate Free Package',
        subtitle: 'Activate this package without making a payment',
    },
    pending: {
        title: 'Activating Package',
        subtitle: 'Please wait while we activate your package',
    },
    errored: {
        title: 'Activation Error',
        subtitle: 'Something went wrong while activating your package',
    },
    success: {
        title: 'Package Activated',
        subtitle: 'Your free package is ready to use',
    },
};

export function PaymentFlow({
    opened,
    onClose,
    seed,
    serviceAccountId,
}: {
    opened: boolean;
    onClose: () => void;
    seed: { packageId: string; price: string } | null;
    serviceAccountId: string | null;
}) {
    const [status, setStatus] = useState<FlowStatus>('buy');
    const [orderId, setOrderId] = useState('');
    const [paymentData, setPaymentData] = useState<OrderResult | null>(null);
    const [errorMessage, setErrorMessage] = useState('');
    const isFree = seed?.price !== '' && Number(seed?.price) === 0;
    const heading = isFree ? FREE_TITLES[status] : TITLES[status];

    return (
        <Modal
            opened={opened}
            onClose={onClose}
            title={
                <Stack gap={2}>
                    <Title order={3}>{heading.title}</Title>
                    <Text size='sm' c='dimmed'>
                        {heading.subtitle}
                    </Text>
                </Stack>
            }
            size='lg'
            centered
        >
            <Paper m='md'>
                {status === 'buy' && seed ? (
                    <BuyForm
                        packageId={seed.packageId}
                        price={seed.price}
                        serviceAccountId={serviceAccountId}
                        onOrder={(result) => {
                            setOrderId(result.orderId);
                            if (result.paymentData) {
                                setPaymentData(result.paymentData);
                            }
                            if (result.status === 'errored') {
                                setErrorMessage(
                                    result.message || 'Payment failed.',
                                );
                            }
                            setStatus(result.status);
                        }}
                    />
                ) : null}

                {status === 'pending' ? (
                    <PendingPayment
                        orderId={orderId}
                        isFree={isFree}
                        onStatusChange={(next, data) => {
                            if (data) setPaymentData(data);
                            setStatus(next);
                        }}
                        onError={(message) => {
                            setErrorMessage(message);
                            setStatus('errored');
                        }}
                        onRetry={() => setStatus('buy')}
                    />
                ) : null}

                {status === 'errored' ? (
                    <PaymentError
                        message={errorMessage}
                        onRetry={() => setStatus('buy')}
                    />
                ) : null}

                {status === 'success' ? (
                    <PaymentSuccess
                        paymentData={paymentData}
                        onDone={onClose}
                    />
                ) : null}
            </Paper>
        </Modal>
    );
}
