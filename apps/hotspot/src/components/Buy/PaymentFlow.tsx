import { useState } from 'react';
import { Modal } from '@mantine/core';
import { BuyForm } from './Form.tsx';
import { PaymentError } from './Payments/PaymentError.tsx';
import { PendingPayment } from './Payments/PaymentPending.tsx';
import { PaymentSuccess } from './Payments/PaymentSuccess.tsx';
import type { FlowStatus, PaymentXHR } from './paymentTypes.ts';

const TITLES: Record<FlowStatus, string> = {
    buy: 'Top-Up',
    pending: 'Processing Payment',
    errored: 'Payment Error',
    success: 'Payment Successful',
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
            title={TITLES[status]}
            size='md'
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
