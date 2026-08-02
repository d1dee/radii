import type { Dispatch, SetStateAction } from 'react';
import { createContext, useContext, useState } from 'react';
import {
    Button,
    Divider,
    Paper,
    Stack,
    TextInput,
} from '@mantine/core';
import { parseServiceProvider } from '@radii/shared';
import { createOrder } from '../../lib/api.ts';
import { ClientContext } from '../Main.tsx';
import type { PaymentData, PaymentXHR } from './paymentTypes.ts';
import { validateForm } from './functions.ts';
import { PreviousNumbers } from './PrevNumbers.tsx';

import { AiOutlineLoading } from 'react-icons/ai';
import { FaPhone } from 'react-icons/fa';

export const RadioContext = createContext<
    [string, Dispatch<SetStateAction<string>>]
>(null!);

export function BuyForm({
    packageId,
    price,
    onOrder,
}: {
    packageId: string;
    price: string;
    onOrder: (result: {
        orderId: string;
        status: 'pending' | 'errored';
        xhr: PaymentXHR;
    }) => void;
}) {
    const client = useContext(ClientContext);
    const prevPaymentMethods = client?.prevPaymentMethods || [];
    const [selectedPhone, setSelectedPhone] = useState('');
    const [error, setError] = useState<string | undefined>(undefined);
    const [btnDisabled, setBtnDisabled] = useState(false);

    async function submitOrder(e: React.MouseEvent<HTMLButtonElement>) {
        e.preventDefault();

        setBtnDisabled(true);

        const phoneNo = selectedPhone ||
            prevPaymentMethods.find(
                (v) =>
                    !(parseServiceProvider(v) instanceof Error) &&
                    parseServiceProvider(v).name === 'safaricom',
            ) || '';

        const data = validateForm({
            phoneNumber: phoneNo,
            packageId,
        });

        if (data instanceof Error) {
            setError(data.message);
            setBtnDisabled(false);
            return;
        }

        try {
            const result = await createOrder({
                packageId: data.packageId,
                phoneNumber: data.phoneNumber,
            });

            const paymentData: PaymentData = {
                paymentId: result.paymentId,
                amount: result.amount,
                packageId: result.packageId,
                status: 'pending',
            };

            onOrder({
                orderId: paymentData.paymentId || '',
                status: 'pending',
                xhr: { success: true, data: paymentData },
            });
        } catch (err) {
            console.warn('Order failed', err);
            onOrder({
                orderId: '',
                status: 'errored',
                xhr: {
                    success: false,
                    message:
                        err instanceof Error
                            ? err.message
                            : 'Could not submit your order.',
                },
            });
        } finally {
            setBtnDisabled(false);
        }
    }

    return (
        <Stack gap="sm" mt="md">
            <RadioContext.Provider value={[selectedPhone, setSelectedPhone]}>
                <PreviousNumbers />
            </RadioContext.Provider>
            <Divider label="or" />
            <Paper shadow="sm" radius="md" p="md" withBorder>
                <TextInput
                    label="Enter phone number:"
                    placeholder="+254712345678 / 0712345678"
                    inputMode="numeric"
                    error={error}
                    leftSection={<FaPhone size={14} />}
                    onChange={(e) => {
                        setSelectedPhone(e.currentTarget.value);
                        setError(undefined);
                    }}
                />
            </Paper>

            <Button
                loading={btnDisabled}
                loaderProps={{ children: <AiOutlineLoading /> }}
                onClick={submitOrder}
                fullWidth
            >
                Pay {price ? `Ksh ${price}` : 'for package'}
            </Button>
        </Stack>
    );
}
