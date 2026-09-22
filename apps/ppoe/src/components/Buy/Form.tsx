import { Button, Divider, Input, Stack } from '@mantine/core';
import { schemaResolver, useForm } from '@mantine/form';
import { parseServiceProvider, zPhoneNumber } from '@radii/shared';
import { PhoneNumberInput } from '@radii/ui';
import { useContext, useState, type FormEvent } from 'react';
import { createOrder, type OrderResult } from '../../lib/api.ts';
import { mutationLogger } from '../../lib/logging.ts';

import { AiOutlineLoading } from 'react-icons/ai';
import z from 'zod';
import { ClientContext } from '../../App.tsx';
import { PrevPaymentMethods } from './PrevPaymentMethods.tsx';

type FormValues = {
    phoneNumber: string;
};

const buyFormSchema = z.object({
    phoneNumber: zPhoneNumber.refine(
        (v) => parseServiceProvider(v)?.name === 'safaricom',
        {
            message: 'Only M-Pesa payment is supported at the moment.',
        },
    ),
});

export function BuyForm({
    packageId,
    price,
    serviceAccountId,
    onOrder,
}: {
    packageId: string;
    price: string;
    serviceAccountId: string | null;
    onOrder: (result: {
        orderId: string;
        status: 'pending' | 'errored' | 'success';
        message?: string;
        paymentData?: OrderResult;
    }) => void;
}) {
    const isFree = price !== '' && Number(price) === 0;
    const client = useContext(ClientContext);
    const prevPaymentMethods = client?.prevPaymentMethods || [];

    const defaultPhone =
        [...prevPaymentMethods, client?.phoneNumber || ''].find(
            (v) => v && parseServiceProvider(v)?.name === 'safaricom',
        ) || '';

    const form = useForm<FormValues>({
        mode: 'controlled',
        initialValues: { phoneNumber: defaultPhone },
        validate: schemaResolver(buyFormSchema, { sync: true }),
    });

    const [inputMethod, setInputMethod] = useState<'radio' | 'input'>(
        defaultPhone ? 'radio' : 'input',
    );
    const [submitting, setSubmitting] = useState(false);

    function setPhone(phone: string, method: 'radio' | 'input') {
        form.setFieldValue('phoneNumber', phone);
        setInputMethod(method);
    }

    async function submitOrder(phoneNumber?: string) {
        setSubmitting(true);
        try {
            const result = await createOrder({
                packageId,
                ...(phoneNumber ? { phoneNumber } : {}),
                serviceAccountId,
            });

            if (!result.success) {
                onOrder({
                    orderId: '',
                    status: 'errored',
                    message:
                        result.message ||
                        (isFree
                            ? 'Could not activate your package.'
                            : 'Could not submit your order.'),
                });
                return;
            }

            const order = result.data!;
            if (order.status === 'failed') {
                onOrder({
                    orderId: order.paymentId,
                    status: 'errored',
                    message: isFree
                        ? 'Could not activate this package.'
                        : 'Payment failed. Please try again.',
                });
                return;
            }

            onOrder({
                orderId: order.paymentId,
                status:
                    order.status === 'paid' && order.activation
                        ? 'success'
                        : 'pending',
                paymentData: order,
            });
        } catch (err) {
            mutationLogger.warning('Unexpected order creation failure.', {
                operation: 'create-order',
                errorName: err instanceof Error ? err.name : 'UnknownError',
            });
            onOrder({
                orderId: '',
                status: 'errored',
                message: isFree
                    ? 'Could not activate your package. Check your connection and try again.'
                    : 'Could not submit your payment. Check your connection and try again.',
            });
        } finally {
            setSubmitting(false);
        }
    }

    async function handleSubmit(values: FormValues) {
        const parsed = buyFormSchema.safeParse(values);
        if (!parsed.success) {
            form.setFieldError(
                'phoneNumber',
                parsed.error.issues[0]?.message ?? '',
            );
            return;
        }

        await submitOrder(parsed.data.phoneNumber);
    }

    function handleFreeSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        void submitOrder();
    }

    return (
        <form
            onSubmit={
                isFree ? handleFreeSubmit : form.onSubmit(handleSubmit)
            }
        >
            <Stack gap='md'>
                {isFree ? null : (
                    <>
                        <Input.Wrapper
                            label='Saved Numbers'
                            description="Choose a number you've paid with before"
                        >
                            <PrevPaymentMethods
                                selectedPhone={form.values.phoneNumber}
                                onSelect={(phone) => setPhone(phone, 'radio')}
                            />
                        </Input.Wrapper>

                        <Divider label='or' />

                        <PhoneNumberInput
                            label='Enter phone number:'
                            description='We send an STK push prompt to this phone'
                            placeholder='712 345 678'
                            error={form.errors.phoneNumber}
                            value={
                                inputMethod === 'input'
                                    ? form.values.phoneNumber
                                    : ''
                            }
                            onChange={(value) => {
                                setPhone(value ?? '', 'input');
                            }}
                        />
                    </>
                )}

                <Button
                    type='submit'
                    mt='md'
                    loading={submitting}
                    loaderProps={{ children: <AiOutlineLoading /> }}
                    fullWidth
                >
                    {isFree
                        ? 'Activate Free Package'
                        : `Pay ${price ? `Ksh ${price}` : 'for package'}`}
                </Button>
            </Stack>
        </form>
    );
}
