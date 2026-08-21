import { Modal, Stack, Text, Title } from '@mantine/core';
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

export function PaymentFlow({
    opened,
    onClose,
    seed,
}: {
    opened: boolean;
    onClose: () => void;
    seed: { packageId: string; price: string } | null;
}) {
    const [status, setStatus] = useState<FlowStatus>('buy');
    const [orderId, setOrderId] = useState('');
    const [paymentData, setPaymentData] = useState<OrderResult | null>(null);
    const [errorMessage, setErrorMessage] = useState('');

    return (
        <Modal
            opened={opened}
            onClose={onClose}
            title={
                <Stack gap={2}>
                    <Title order={3}>{TITLES[status].title}</Title>
                    <Text size='sm' c='dimmed'>
                        {TITLES[status].subtitle}
                    </Text>
                </Stack>
            }
            size='lg'
            centered
        >
            {status === 'buy' && seed ? (
                <BuyForm
                    packageId={seed.packageId}
                    price={seed.price}
                    onOrder={(result) => {
                        setOrderId(result.orderId);
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
                <PaymentSuccess paymentData={paymentData} onDone={onClose} />
            ) : null}
        </Modal>
    );
}
