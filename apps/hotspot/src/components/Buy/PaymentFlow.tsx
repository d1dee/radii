import { Modal, Stack, Text, Title } from '@mantine/core';
import { useState } from 'react';
import { BuyForm } from './Form.tsx';
import { PaymentError } from './Payments/PaymentError.tsx';
import { PendingPayment } from './Payments/PaymentPending.tsx';
import { PaymentSuccess } from './Payments/PaymentSuccess.tsx';
import type { FlowStatus, PaymentXHR } from './paymentTypes.ts';

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
    const [xhr, setXHR] = useState<PaymentXHR | undefined>();

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
                        setXHR(result.xhr);
                        setStatus(result.status);
                    }}
                />
            ) : null}

            {status === 'pending' ? (
                <PendingPayment
                    orderId={orderId}
                    onStatusChange={(next, res) => {
                        if (res) setXHR(res);
                        if (next !== 'pending') setStatus(next);
                    }}
                    onRetry={() => setStatus('buy')}
                />
            ) : null}

            {status === 'errored' ? (
                <PaymentError xhr={xhr} onRetry={() => setStatus('buy')} />
            ) : null}

            {status === 'success' ? (
                <PaymentSuccess xhr={xhr} onDone={onClose} />
            ) : null}
        </Modal>
    );
}
