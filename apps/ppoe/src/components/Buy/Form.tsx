import { Button, Divider, Input, Stack } from '@mantine/core';
import { schemaResolver, useForm } from '@mantine/form';
import { parseServiceProvider, zPhoneNumber } from '@radii/shared';
import { PhoneNumberInput } from '@radii/ui';
import { useContext, useState } from 'react';
import { createOrder } from '../../lib/api.ts';

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
        status: 'pending' | 'errored';
        message?: string;
    }) => void;
}) {
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

    function setPhone(phone: string, method: 'radio' | 'input') {
        form.setFieldValue('phoneNumber', phone);
        setInputMethod(method);
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

        try {
            const result = await createOrder({
                packageId,
                phoneNumber: parsed.data.phoneNumber,
                serviceAccountId,
            });

            if (!result.success) {
                onOrder({
                    orderId: '',
                    status: 'errored',
                    message: result.message || 'Could not submit your order.',
                });
                return;
            }

            onOrder({
                orderId: result.data!.paymentId,
                status: 'pending',
            });
        } catch (err) {
            console.warn('Order failed', err);
            onOrder({
                orderId: '',
                status: 'errored',
                message:
                    err instanceof Error
                        ? err.message
                        : 'Could not submit your order.',
            });
        }
    }

    return (
        <form onSubmit={form.onSubmit(handleSubmit)}>
            <Stack gap='md'>
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
                        inputMethod === 'input' ? form.values.phoneNumber : ''
                    }
                    onChange={(value) => {
                        setPhone(value ?? '', 'input');
                    }}
                />

                <Button
                    type='submit'
                    mt='md'
                    loading={form.submitting}
                    loaderProps={{ children: <AiOutlineLoading /> }}
                    fullWidth
                >
                    Pay {price ? `Ksh ${price}` : 'for package'}
                </Button>
            </Stack>
        </form>
    );
}
