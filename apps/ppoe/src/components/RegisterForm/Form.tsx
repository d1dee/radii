import { Button, Input, PinInput, Stack, Text } from '@mantine/core';
import { schemaResolver, useForm } from '@mantine/form';
import { hasFieldErrors, loginSchema, signUpSchema } from '@radii/shared';
import { PhoneNumberInput } from '@radii/ui';
import { useContext, useState } from 'react';
import { ModalActionsContext } from '../../App.tsx';
import { login, register } from '../../lib/api.ts';
import { useSession } from '../../lib/auth.ts';

type FormValues = {
    phoneNumber: string;
    pin: string;
    verifyPin: string;
};

export function RegisterForm({
    mode,
    packageId,
    price,
    onClose,
}: {
    mode: 'register' | 'login';
    packageId: string;
    price: string;
    onClose: () => void;
}) {
    const { startBuy } = useContext(ModalActionsContext);
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    const { refetch } = useSession();
    const form = useForm<FormValues>({
        mode: 'controlled',
        initialValues: { phoneNumber: '', pin: '', verifyPin: '' },
        validate: schemaResolver(
            mode === 'register' ? signUpSchema : loginSchema,
            { sync: true },
        ),
    });

    async function handleSubmit(values: FormValues) {
        setFormError(null);
        setSubmitting(true);

        if (packageId && packageId !== 'null') {
            localStorage.setItem('packageId', packageId);
        }

        const result =
            mode === 'register' ? await register(values) : await login(values);

        setSubmitting(false);

        if (!result.success) {
            // Failed responses share one envelope; per-field form errors
            // live in `data.fieldErrors` (any type: VALIDATION_ERROR,
            // CONFLICT for duplicates, UNAUTHORIZED for bad credentials…).
            if (hasFieldErrors(result.data))
                form.setErrors(result.data.fieldErrors);
            else
                setFormError(
                    result.message || 'Authentication error, contact support',
                );
            return;
        }

        // The backend set the session cookie; refresh the client-side
        // session so `useSession` (and the /me loader) react to it.
        await refetch();
        onClose();

        if (packageId && packageId !== 'null') {
            startBuy({ packageId, price });
            localStorage.removeItem('packageId');
        }
    }

    return (
        <form onSubmit={form.onSubmit(handleSubmit)}>
            <Stack gap='md'>
                <PhoneNumberInput
                    label='Phone number:'
                    autoComplete='tel'
                    placeholder='712 345 678'
                    value={form.values.phoneNumber}
                    onChange={(value) =>
                        form.setFieldValue('phoneNumber', value ?? '')
                    }
                    error={form.errors.phoneNumber}
                />

                <Input.Wrapper label='PIN:' error={form.errors.pin}>
                    <PinInput
                        value={form.values.pin}
                        onChange={(value) => form.setFieldValue('pin', value)}
                        error={!!form.errors.pin}
                        length={4}
                        type='number'
                        inputMode='numeric'
                        placeholder='•'
                        getInputProps={() => ({
                            autoComplete:
                                mode === 'register'
                                    ? 'new-password'
                                    : 'current-password',
                        })}
                    />
                </Input.Wrapper>

                {mode === 'register' ? (
                    <Input.Wrapper
                        label='Verify PIN:'
                        error={form.errors.verifyPin}
                    >
                        <PinInput
                            value={form.values.verifyPin}
                            onChange={(value) =>
                                form.setFieldValue('verifyPin', value)
                            }
                            error={!!form.errors.verifyPin}
                            length={4}
                            type='number'
                            inputMode='numeric'
                            placeholder='•'
                            getInputProps={() => ({
                                autoComplete: 'new-password',
                            })}
                        />
                    </Input.Wrapper>
                ) : null}

                {formError ? (
                    <Text size='sm' c='red'>
                        {formError}
                    </Text>
                ) : null}

                <Button type='submit' loading={submitting} mt='sm'>
                    {submitting ? 'Please wait…' : 'Submit'}
                </Button>
            </Stack>
        </form>
    );
}
