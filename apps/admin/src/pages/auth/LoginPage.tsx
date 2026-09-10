import {
    Anchor,
    Button,
    Card,
    Center,
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
        } finally {
            setLoading(false);
        }
    }

    return (
        <Center mih='100vh' p='md'>
            <Card withBorder shadow='md' radius='md' p='xl' w={420} maw='100%'>
                <Stack gap='lg'>
                    <Stack gap={4}>
                        <Title order={2}>Radii Admin</Title>
                        <Text size='sm' c='dimmed'>
                            Sign in to the admin console
                        </Text>
                    </Stack>

                    <form onSubmit={form.onSubmit(onSubmit)}>
                        <Stack gap='md'>
                            <TextInput
                                label='Email'
                                type='email'
                                autoComplete='username'
                                required
                                {...form.getInputProps('email')}
                            />
                            <PasswordInput
                                label='Password'
                                autoComplete='current-password'
                                required
                                {...form.getInputProps('password')}
                            />
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
                </Stack>
            </Card>
        </Center>
    );
}
