import {
    Anchor,
    Button,
    Divider,
    Group,
    Input,
    Paper,
    PinInput,
    Stack,
    Text,
} from '@mantine/core';
import { schemaResolver, useForm } from '@mantine/form';
import { hasFieldErrors, loginSchema } from '@radii/shared';
import { PhoneNumberInput } from '@radii/ui';
import { useContext, useState } from 'react';
import { ModalActionsContext } from '../../App.tsx';
import { login } from '../../lib/api.ts';
import { useSession } from '../../lib/auth.ts';
import { mutationLogger } from '../../lib/logging.ts';

type FormValues = {
    phoneNumber: string;
    pin: string;
};

// Inline sign-in for visitors the portal cannot place on a network yet: with
// no scoped NAS there are no packages to show, so signing in is the only way
// forward — it lets the portal resolve the network from the customer's own
// accounts. The modal sign-in stays in place for the case where the NAS of
// the portal is known.
export function LoginCard() {
    const { openRegister, openForgotPin } = useContext(ModalActionsContext);
    const { refetch } = useSession();
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    const form = useForm<FormValues>({
        mode: 'controlled',
        initialValues: {
            phoneNumber: '',
            pin: '',
        },
        validate: schemaResolver(loginSchema, { sync: true }),
    });

    async function handleSubmit(values: FormValues) {
        setFormError(null);
        setSubmitting(true);

        try {
            const result = await login(values);
            if (!result.success) {
                // Failed responses share one envelope; per-field form errors
                // live in `data.fieldErrors`.
                if (hasFieldErrors(result.data)) {
                    form.setErrors(result.data.fieldErrors);
                } else {
                    setFormError(
                        result.message || 'Could not sign in. Try again.',
                    );
                }
                return;
            }

            // The backend set the session cookie; refresh the client-side
            // session so the portal can pick the network of the accounts
            // behind this sign-in.
            await refetch();
        } catch (error) {
            mutationLogger.warning('Unexpected portal sign-in failure.', {
                operation: 'login',
                errorName: error instanceof Error ? error.name : 'UnknownError',
            });
            setFormError('Could not complete sign in. Try again.');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Paper shadow='xl' radius='lg' p='lg' withBorder>
            <form onSubmit={form.onSubmit(handleSubmit)}>
                <Stack gap='md'>
                    <Stack gap='xs'>
                        <Text size='lg' fw={600}>
                            Sign in to your account
                        </Text>
                        <Text size='sm' c='dimmed'>
                            Sign in and we will connect you to the network your
                            service runs on.
                        </Text>
                    </Stack>

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
                                autoComplete: 'current-password',
                            })}
                        />
                    </Input.Wrapper>

                    {formError ? (
                        <Text size='sm' c='red'>
                            {formError}
                        </Text>
                    ) : null}

                    <Button type='submit' loading={submitting} mt='sm'>
                        {submitting ? 'Please wait…' : 'Sign in'}
                    </Button>

                    <Divider label='or' />

                    <Group justify='space-between'>
                        <Anchor
                            component='button'
                            type='button'
                            size='sm'
                            onClick={openForgotPin}
                        >
                            Forgot PIN?
                        </Anchor>
                        <Anchor
                            component='button'
                            type='button'
                            size='sm'
                            onClick={() => openRegister()}
                        >
                            Create an account
                        </Anchor>
                    </Group>
                </Stack>
            </form>
        </Paper>
    );
}
