import {
    Anchor,
    Button,
    Card,
    Center,
    Group,
    PasswordInput,
    PinInput,
    Stack,
    Text,
    TextInput,
    Title,
} from '@mantine/core';
import { schemaResolver, useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { adminResetPasswordSchema } from '@shared/index';
import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';

import { authClient, useSession } from '@/lib/auth';

// Email-OTP password reset on the dedicated admin BetterAuth instance:
// request a 6-digit code by email (valid 5 minutes), then redeem it with a
// new password that satisfies the admin password policy (enforced again
// server-side by the PASSWORD_GUARDED_PATHS hook in adminAuth.ts).
export default function ForgotPasswordPage() {
    const navigate = useNavigate();
    const { data: session, isPending: sessionPending } = useSession();
    const [step, setStep] = useState<'request' | 'reset'>('request');
    const [requesting, setRequesting] = useState(false);
    const [resetting, setResetting] = useState(false);

    const form = useForm({
        initialValues: {
            email: '',
            otp: '',
            password: '',
            confirmPassword: '',
        },
        validate: schemaResolver(adminResetPasswordSchema),
    });

    if (!sessionPending && session?.user.emailVerified) {
        return <Navigate to='/' replace />;
    }

    // Step 1 only needs a valid email; the full schema (otp + password rules)
    // applies to step 2, so validate the single field manually here.
    async function handleRequest() {
        if (!/^\S+@\S+\.\S+$/.test(form.values.email)) {
            form.setFieldError('email', 'Enter a valid email address');
            return;
        }
        setRequesting(true);
        try {
            const { error } = await authClient.emailOtp.requestPasswordReset({
                email: form.values.email.trim(),
            });
            if (error) {
                notifications.show({
                    color: 'red',
                    message: error.message || 'Could not send the reset code',
                });
                return;
            }
            notifications.show({
                color: 'blue',
                message: `We sent a 6-digit reset code to ${form.values.email}`,
            });
            setStep('reset');
        } finally {
            setRequesting(false);
        }
    }

    async function onReset(values: {
        email: string;
        otp: string;
        password: string;
    }) {
        setResetting(true);
        try {
            const { error } = await authClient.emailOtp.resetPassword({
                email: values.email,
                otp: values.otp,
                password: values.password,
            });
            if (error) {
                notifications.show({
                    color: 'red',
                    message: error.message || 'Password reset failed',
                });
                form.setFieldError('otp', error.message || 'Invalid code');
                return;
            }
            notifications.show({
                color: 'green',
                message: 'Password updated — sign in with your new password',
            });
            navigate('/login', { replace: true });
        } finally {
            setResetting(false);
        }
    }

    const isRequest = step === 'request';

    return (
        <Center mih='100vh' p='md'>
            <Card withBorder shadow='md' radius='md' p='xl' w={420} maw='100%'>
                <Stack gap='lg'>
                    <Stack gap={4}>
                        <Title order={2}>Reset password</Title>
                        <Text size='sm' c='dimmed'>
                            {isRequest
                                ? 'Enter your admin email and we will send you a 6-digit reset code.'
                                : 'Enter the 6-digit code we emailed you and choose a new password.'}
                        </Text>
                    </Stack>

                    <form onSubmit={form.onSubmit(onReset)}>
                        <Stack gap='md'>
                            <TextInput
                                label='Email'
                                type='email'
                                autoComplete='username'
                                required
                                disabled={!isRequest}
                                {...form.getInputProps('email')}
                            />

                            {!isRequest ? (
                                <>
                                    <Group gap='sm' align='flex-start'>
                                        <Stack gap={4}>
                                            <Text size='sm' fw={500}>
                                                Reset code
                                            </Text>
                                            <PinInput
                                                length={6}
                                                oneTimeCode
                                                ariaLabel='6-digit reset code'
                                                value={form.values.otp}
                                                onChange={(value) =>
                                                    form.setFieldValue(
                                                        'otp',
                                                        value,
                                                    )
                                                }
                                                error={!!form.errors.otp}
                                            />
                                        </Stack>
                                    </Group>
                                    {form.errors.otp ? (
                                        <Text size='xs' c='red'>
                                            {form.errors.otp}
                                        </Text>
                                    ) : null}
                                    <PasswordInput
                                        label='New password'
                                        autoComplete='new-password'
                                        required
                                        description='At least 8 characters, combining 2 of: lowercase, uppercase, numbers, symbols'
                                        {...form.getInputProps('password')}
                                    />
                                    <PasswordInput
                                        label='Confirm new password'
                                        autoComplete='new-password'
                                        required
                                        {...form.getInputProps('confirmPassword')}
                                    />
                                </>
                            ) : null}

                            <Button
                                type={isRequest ? 'button' : 'submit'}
                                fullWidth
                                loading={isRequest ? requesting : resetting}
                                onClick={
                                    isRequest
                                        ? () => void handleRequest()
                                        : undefined
                                }
                            >
                                {isRequest ? 'Send reset code' : 'Reset password'}
                            </Button>
                        </Stack>
                    </form>

                    <Text size='sm' ta='center' c='dimmed'>
                        Remembered it?{' '}
                        <Anchor component={Link} to='/login' size='sm'>
                            Back to sign in
                        </Anchor>
                    </Text>
                </Stack>
            </Card>
        </Center>
    );
}
