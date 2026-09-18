import { Button, Input, PinInput, Stack, Text } from '@mantine/core';
import { schemaResolver, useForm } from '@mantine/form';
import { forgotPinSchema, hasFieldErrors, resetPinSchema } from '@radii/shared';
import { PhoneNumberInput } from '@radii/ui';
import { useState } from 'react';
import { forgotPin, resetPin } from '../../lib/api.ts';

type RequestValues = { phoneNumber: string };
type ResetValues = {
    phoneNumber: string;
    otp: string;
    pin: string;
    verifyPin: string;
};

// Forget-PIN flow: request a 6-digit SMS code by phone, then redeem it for a
// new 4-digit PIN. Three local steps: request -> reset -> done.
export function ResetPinForm({
    onModeChange,
}: {
    onModeChange: (mode: 'register' | 'login' | 'reset') => void;
}) {
    const [step, setStep] = useState<'request' | 'reset' | 'done'>('request');
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);

    const requestForm = useForm<RequestValues>({
        mode: 'controlled',
        initialValues: { phoneNumber: '' },
        validate: schemaResolver(forgotPinSchema, { sync: true }),
    });
    const resetForm = useForm<ResetValues>({
        mode: 'controlled',
        initialValues: { phoneNumber: '', otp: '', pin: '', verifyPin: '' },
        validate: schemaResolver(resetPinSchema, { sync: true }),
    });

    async function handleRequest(values: RequestValues) {
        setFormError(null);
        setSubmitting(true);
        const result = await forgotPin(values);
        setSubmitting(false);

        if (!result.success) {
            if (hasFieldErrors(result.data))
                requestForm.setErrors(result.data.fieldErrors);
            else
                setFormError(
                    result.message || 'Could not send the code, contact support',
                );
            return;
        }
        resetForm.setFieldValue('phoneNumber', values.phoneNumber);
        setStep('reset');
    }

    async function handleReset(values: ResetValues) {
        setFormError(null);
        setSubmitting(true);
        const result = await resetPin(values);
        setSubmitting(false);

        if (!result.success) {
            if (hasFieldErrors(result.data))
                resetForm.setErrors(result.data.fieldErrors);
            else
                setFormError(
                    result.message || 'Could not reset the PIN, contact support',
                );
            return;
        }
        setStep('done');
    }

    if (step === 'done') {
        return (
            <Stack gap='md'>
                <Text size='sm' c='green'>
                    Your PIN was updated. Sign in with your new PIN.
                </Text>
                <Button onClick={() => onModeChange('login')}>
                    Back to login
                </Button>
            </Stack>
        );
    }

    if (step === 'reset') {
        return (
            <form onSubmit={resetForm.onSubmit(handleReset)}>
                <Stack gap='md'>
                    <Text size='sm' c='dimmed'>
                        Code sent to {resetForm.values.phoneNumber}. It expires
                        in 5 minutes.
                    </Text>

                    <Input.Wrapper label='Code:' error={resetForm.errors.otp}>
                        <PinInput
                            value={resetForm.values.otp}
                            onChange={(value) =>
                                resetForm.setFieldValue('otp', value)
                            }
                            error={!!resetForm.errors.otp}
                            length={6}
                            type='number'
                            inputMode='numeric'
                            oneTimeCode
                            ariaLabel='6-digit reset code'
                            getInputProps={() => ({
                                autoComplete: 'one-time-code',
                            })}
                        />
                    </Input.Wrapper>

                    <Input.Wrapper
                        label='New PIN:'
                        error={resetForm.errors.pin}
                    >
                        <PinInput
                            value={resetForm.values.pin}
                            onChange={(value) =>
                                resetForm.setFieldValue('pin', value)
                            }
                            error={!!resetForm.errors.pin}
                            length={4}
                            type='number'
                            inputMode='numeric'
                            placeholder='•'
                            getInputProps={() => ({
                                autoComplete: 'new-password',
                            })}
                        />
                    </Input.Wrapper>

                    <Input.Wrapper
                        label='Verify new PIN:'
                        error={resetForm.errors.verifyPin}
                    >
                        <PinInput
                            value={resetForm.values.verifyPin}
                            onChange={(value) =>
                                resetForm.setFieldValue('verifyPin', value)
                            }
                            error={!!resetForm.errors.verifyPin}
                            length={4}
                            type='number'
                            inputMode='numeric'
                            placeholder='•'
                            getInputProps={() => ({
                                autoComplete: 'new-password',
                            })}
                        />
                    </Input.Wrapper>

                    {formError ? (
                        <Text size='sm' c='red'>
                            {formError}
                        </Text>
                    ) : null}

                    <Button type='submit' loading={submitting} mt='sm'>
                        {submitting ? 'Please wait…' : 'Reset PIN'}
                    </Button>
                    <Button
                        variant='subtle'
                        size='xs'
                        onClick={() => {
                            setFormError(null);
                            setStep('request');
                        }}
                    >
                        Use a different number
                    </Button>
                </Stack>
            </form>
        );
    }

    return (
        <form onSubmit={requestForm.onSubmit(handleRequest)}>
            <Stack gap='md'>
                <PhoneNumberInput
                    label='Phone number:'
                    autoComplete='tel'
                    placeholder='712 345 678'
                    value={requestForm.values.phoneNumber}
                    onChange={(value) =>
                        requestForm.setFieldValue('phoneNumber', value ?? '')
                    }
                    error={requestForm.errors.phoneNumber}
                />

                {formError ? (
                    <Text size='sm' c='red'>
                        {formError}
                    </Text>
                ) : null}

                <Button type='submit' loading={submitting} mt='sm'>
                    {submitting ? 'Please wait…' : 'Send code'}
                </Button>
            </Stack>
        </form>
    );
}
