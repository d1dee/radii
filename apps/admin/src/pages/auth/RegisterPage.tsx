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
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { adminRegisterSchema } from '@shared/index';
import { zod4Resolver } from 'mantine-form-zod-resolver';
import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';

import { authClient, useSession } from '@/lib/auth';

export default function RegisterPage() {
    const navigate = useNavigate();
    const { data: session, isPending: sessionPending } = useSession();
    const [loading, setLoading] = useState(false);

    const form = useForm({
        initialValues: {
            name: '',
            email: '',
            password: '',
            confirmPassword: '',
        },
        validate: zod4Resolver(adminRegisterSchema),
    });

    // Registration is open (no manual approval), but an admin with a verified
    // email lands in the console directly.
    if (!sessionPending && session?.user.emailVerified) {
        return <Navigate to='/' replace />;
    }

    async function onSubmit(values: {
        name: string;
        email: string;
        password: string;
    }) {
        setLoading(true);
        try {
            const { error } = await authClient.signUp.email({
                name: values.name,
                email: values.email,
                password: values.password,
            });
            if (error) {
                notifications.show({
                    color: 'red',
                    message: error.message || 'Could not create the admin account',
                });
                return;
            }
            // Sign-up succeeded: a 2FA-style 6-digit verification code is on
            // its way to the admin's email. No session is created until that
            // email is verified (requireEmailVerification).
            notifications.show({
                color: 'blue',
                message: `We sent a 6-digit verification code to ${values.email}`,
            });
            navigate('/verify-email', {
                state: { email: values.email },
            });
        } finally {
            setLoading(false);
        }
    }

    return (
        <Center mih='100vh' p='md'>
            <Card withBorder shadow='md' radius='md' p='xl' w={420} maw='100%'>
                <Stack gap='lg'>
                    <Stack gap={4}>
                        <Title order={2}>Create admin account</Title>
                        <Text size='sm' c='dimmed'>
                            Administrators manage NAS devices, packages,
                            customers and payments.
                        </Text>
                    </Stack>

                    <form onSubmit={form.onSubmit(onSubmit)}>
                        <Stack gap='md'>
                            <TextInput
                                label='Full name'
                                autoComplete='name'
                                required
                                {...form.getInputProps('name')}
                            />
                            <TextInput
                                label='Email'
                                type='email'
                                autoComplete='username'
                                required
                                {...form.getInputProps('email')}
                            />
                            <PasswordInput
                                label='Password'
                                autoComplete='new-password'
                                required
                                description='At least 8 characters, combining 2 of: lowercase, uppercase, numbers, symbols'
                                {...form.getInputProps('password')}
                            />
                            <PasswordInput
                                label='Confirm password'
                                autoComplete='new-password'
                                required
                                {...form.getInputProps('confirmPassword')}
                            />
                            <Button type='submit' fullWidth loading={loading}>
                                Create account
                            </Button>
                        </Stack>
                    </form>

                    <Divider label='or' labelPosition='center' />
                    <Text size='sm' ta='center'>
                        Already registered?{' '}
                        <Anchor component={Link} to='/login' size='sm'>
                            Sign in
                        </Anchor>
                    </Text>
                </Stack>
            </Card>
        </Center>
    );
}
