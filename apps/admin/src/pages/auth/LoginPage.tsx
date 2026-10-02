import {
    Anchor,
    Button,
    Divider,
    PasswordInput,
    Stack,
    Text,
    TextInput,
    Title,
} from '@mantine/core';
import { schemaResolver, useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { adminLoginSchema } from '@shared/index';
import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';

import { authClient, useSession } from '@/lib/auth';
import { reportClientError } from '@/lib/clientError';
import { AuthPageLayout } from '@/components/Layout/AuthPageLayout';

export default function LoginPage() {
    const navigate = useNavigate();
    const location = useLocation();
    const { data: session, isPending: sessionPending } = useSession();
    const [loading, setLoading] = useState(false);

    const form = useForm({
        initialValues: {
            email: '',
            password: '',
        },
        validate: schemaResolver(adminLoginSchema),
    });

    // Already signed in with a verified admin email -> straight to console.
    if (!sessionPending && session?.user.emailVerified) {
        return <Navigate to='/' replace />;
    }

    async function onSubmit(values: { email: string; password: string }) {
        setLoading(true);
        try {
            const { error } = await authClient.signIn.email({
                email: values.email,
                password: values.password,
            });
            if (error) {
                if (error.status === 403) {
                    // Email not verified yet. The server re-sends an OTP on
                    // this failed sign-in (sendOnSignIn), so go straight to
                    // the code entry screen.
                    notifications.show({
                        color: 'blue',
                        message:
                            'Check your email — we sent you a 6-digit verification code',
                    });
                    navigate('/verify-email', {
                        state: { email: values.email },
                    });
                    return;
                }
                notifications.show({
                    color: 'red',
                    message: error.message || 'Sign in failed',
                });
                return;
            }
            const from = (location.state as { from?: string } | null)?.from;
            navigate(from ?? '/', { replace: true });
        } catch (error) {
            notifications.show({
                color: 'red',
                message: reportClientError(
                    error,
                    'admin sign in',
                    'Sign in could not be completed. Try again.',
                ),
            });
        } finally {
            setLoading(false);
        }
    }

    return (
        <AuthPageLayout
            label='Sign in'
            header={
                <Stack gap={4}>
                    <Title order={2} size='h3'>
                        Radii Admin
                    </Title>
                    <Text size='sm' c='dimmed'>
                        Sign in to the admin console
                    </Text>
                </Stack>
            }
        >
            <form onSubmit={form.onSubmit(onSubmit)}>
                <Stack gap='md'>
                    <TextInput
                        label='Email'
                        type='email'
                        inputMode='email'
                        autoCapitalize='none'
                        autoComplete='username'
                        required
                        {...form.getInputProps('email')}
                    />
                    <PasswordInput
                        label='Password'
                        autoComplete='current-password'
                        visibilityToggleButtonProps={{
                            'aria-label': 'Toggle password visibility',
                        }}
                        required
                        {...form.getInputProps('password')}
                    />
                    <Anchor
                        component={Link}
                        to='/forgot-password'
                        size='sm'
                        ta='right'
                    >
                        Forgot password?
                    </Anchor>
                    <Button type='submit' fullWidth loading={loading}>
                        Sign in
                    </Button>
                </Stack>
            </form>

            <Divider label='or' labelPosition='center' />
            <Text size='sm' ta='center'>
                No admin account yet?{' '}
                <Anchor component={Link} to='/register' size='sm'>
                    Create one
                </Anchor>
            </Text>
        </AuthPageLayout>
    );
}
