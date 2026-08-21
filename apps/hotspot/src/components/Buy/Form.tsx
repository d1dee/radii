import { Button, Divider, Input, Stack } from '@mantine/core';
import { parseServiceProvider } from '@radii/shared';
import { schemaResolver, useForm } from '@mantine/form';
import { PhoneNumberInput } from '@radii/ui';
import { useContext, useState } from 'react';
import { createOrder } from '../../lib/api.ts';
import { ClientContext } from '../Main.tsx';
import { buyFormSchema, validateForm } from './functions.ts';
import type { PaymentData, PaymentXHR } from './paymentTypes.ts';

import { AiOutlineLoading } from 'react-icons/ai';
import { PrevPaymentMethods } from './PrevPaymentMethods.tsx';

type FormValues = {
    phoneNumber: string;
};

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

    const defaultPhone =
        prevPaymentMethods.find(
            (v) => parseServiceProvider(v)?.name === 'safaricom',
        ) || '';

    const form = useForm<FormValues>({
        mode: 'controlled',
        initialValues: { phoneNumber: defaultPhone },
        validate: schemaResolver(buyFormSchema, { sync: true }),
    });

    const [inputMethod, setInputMethod] = useState<'radio' | 'input'>(
        defaultPhone ? 'radio' : 'input',
    );
    const [btnDisabled, setBtnDisabled] = useState(false);

    function setPhone(phone: string, method: 'radio' | 'input') {
        form.setFieldValue('phoneNumber', phone);
        setInputMethod(method);
    }

    async function handleSubmit(values: FormValues) {
        setBtnDisabled(true);

        const data = validateForm({
            phoneNumber: values.phoneNumber,
            packageId,
        });

        if (data instanceof Error) {
            form.setFieldError('phoneNumber', data.message);
            setBtnDisabled(false);
            return;
        }

        try {
            const result = await createOrder({
                packageId: data.packageId,
                phoneNumber: data.phoneNumber,
            });

            if (!result.success || !result.data) {
                onOrder({
                    orderId: '',
                    status: 'errored',
                    xhr: {
                        success: false,
                        message: result.success
                            ? 'Could not submit your order.'
                            : result.message,
                    },
                });
                return;
            }

            const paymentData: PaymentData = {
                ...result.data,
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
        <form onSubmit={form.onSubmit(handleSubmit)}>
            <Stack gap='md' m='md'>
                <Input.Wrapper
                    label='Saved Numbers'
                    description="Choose a number you've paid with before"
                    error={form.errors.phoneNumber}
                >
                    <PrevPaymentMethods
                        phoneNumber={form.values.phoneNumber}
                        inputMethod={inputMethod}
                        setPhone={setPhone}
                    />
                </Input.Wrapper>

                <Divider label='or' />

                <PhoneNumberInput
                    label='Enter phone number:'
                    description='We send an STK push prompt to this phone'
                    placeholder='712 345 678'
                    error={form.errors.phoneNumber}
                    value={inputMethod === 'input' ? form.values.phoneNumber : ''}
                    onChange={(value) => {
                        setPhone(value ?? '', 'input');
                    }}
                />

                <Button
                    type='submit'
                    mt='md'
                    loading={btnDisabled}
                    loaderProps={{ children: <AiOutlineLoading /> }}
                    fullWidth
                >
                    Pay {price ? `Ksh ${price}` : 'for package'}
                </Button>
            </Stack>
        </form>
    );
}
