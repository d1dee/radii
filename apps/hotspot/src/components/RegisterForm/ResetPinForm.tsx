import { Button, Group, Input, PinInput, Stack, Text } from '@mantine/core';
import { schemaResolver, useForm } from '@mantine/form';
import { forgotPinSchema, hasFieldErrors, resetPinSchema } from '@radii/shared';
import { PhoneNumberInput } from '@radii/ui';
import { useState } from 'react';
import { forgotPin, resetPin } from '../../lib/api.ts';
import { mutationLogger } from '../../lib/logging.ts';

type RequestValues = { phoneNumber: string };
type ResetValues = {
    phoneNumber: string;
    otp: string;
    pin: string;
    verifyPin: string;
};

// Forget-PIN flow: request a 6-digit WhatsApp code by phone, then redeem it for a
// new 4-digit PIN. Three local steps: request -> reset -> done.
export function ResetPinForm({ onBackToLogin }: { onBackToLogin: () => void }) {
    const [step, setStep] = useState<'request' | 'reset' | 'done'>('request');
    const [submitting, setSubmitting] = useState(false);
    const [resending, setResending] = useState(false);
    const [codeResent, setCodeResent] = useState(false);
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
        setCodeResent(false);
        setSubmitting(true);
        try {
            const result = await forgotPin(values);
            if (!result.success) {
                if (hasFieldErrors(result.data)) {
                    if (step === 'request')
                        requestForm.setErrors(result.data.fieldErrors);
                    else
                        setFormError(
                            'Could not resend the code. Try again or contact support.',
                        );
                } else {
                    setFormError(
                        result.message ||
                            'Could not send the code. Try again or contact support.',
                    );
                }
                return;
            }
            resetForm.setFieldValue('phoneNumber', values.phoneNumber);
            if (step === 'reset') {
                resetForm.setFieldValue('otp', '');
                resetForm.clearFieldError('otp');
                setCodeResent(true);
            }
            setStep('reset');
        } catch (error) {
            mutationLogger.warning('Unexpected reset code request failure.', {
                operation: 'forgot-pin',
                errorName: error instanceof Error ? error.name : 'UnknownError',
            });
            setFormError('Could not send the reset code. Try again.');
        } finally {
            setSubmitting(false);
        }
    }

    async function handleResend() {
        if (submitting) return;
        setResending(true);
        try {
            await handleRequest({ phoneNumber: resetForm.values.phoneNumber });
        } finally {
            setResending(false);
        }
    }

    async function handleReset(values: ResetValues) {
        setFormError(null);
        setSubmitting(true);
        try {
            const result = await resetPin(values);
            if (!result.success) {
                if (hasFieldErrors(result.data)) {
                    resetForm.setErrors(result.data.fieldErrors);
                } else {
                    setFormError(
                        result.message ||
                            'Could not reset the PIN. Try again or contact support.',
                    );
                }
                return;
            }
            setStep('done');
        } catch (error) {
            mutationLogger.warning('Unexpected PIN reset failure.', {
                operation: 'reset-pin',
                errorName: error instanceof Error ? error.name : 'UnknownError',
            });
            setFormError('Could not reset the PIN. Try again.');
        } finally {
            setSubmitting(false);
        }
    }

    if (step === 'done') {
        return (
            <Stack gap='md'>
                <Text size='sm' c='green'>
                    Your PIN was updated. Sign in with your new PIN.
                </Text>
                <Button variant='default' onClick={onBackToLogin}>
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
                        If delivery is available, a WhatsApp code will arrive at{' '}
                        {resetForm.values.phoneNumber}. It expires in 5 minutes.
                    </Text>

                    <Input.Wrapper
                        label='Code:'
                        error={resetForm.errors.otp}
                        descriptionProps={{ pb: 'xs' }}
                    >
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
                        descriptionProps={{ pb: 'xs' }}
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
                        descriptionProps={{ pb: 'xs' }}
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

                    {codeResent ? (
                        <Text size='sm' c='green' role='status'>
                            A new code was requested. Check your WhatsApp
                            messages.
                        </Text>
                    ) : null}

                    <Button
                        type='submit'
                        loading={submitting && !resending}
                        disabled={resending}
                        mt='sm'
                    >
                        {submitting ? 'Please wait…' : 'Reset PIN'}
                    </Button>
                    <Group justify='space-between' grow>
                        <Button
                            type='button'
                            variant='default'
                            loading={resending}
                            disabled={submitting && !resending}
                            onClick={handleResend}
                        >
                            Resend code
                        </Button>
                        <Button
                            type='button'
                            variant='outline'
                            onClick={onBackToLogin}
                        >
                            Back to login
                        </Button>
                    </Group>
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
                    {submitting ? 'Please wait…' : 'Send WhatsApp code'}
                </Button>
                <Button type='button' variant='default' onClick={onBackToLogin}>
                    Back to login
                </Button>
            </Stack>
        </form>
    );
}
