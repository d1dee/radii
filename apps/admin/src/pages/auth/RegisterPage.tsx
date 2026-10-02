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
import { adminRegisterSchema } from '@shared/index';
import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';

import { authClient, useSession } from '@/lib/auth';
import { reportClientError } from '@/lib/clientError';
import { AuthPageLayout } from '@/components/Layout/AuthPageLayout';

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
        validate: schemaResolver(adminRegisterSchema),
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
                    message:
                        error.message || 'Could not create the admin account',
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
        } catch (error) {
            notifications.show({
                color: 'red',
                message: reportClientError(
                    error,
                    'admin registration',
                    'The admin account could not be created. Try again.',
                ),
            });
        } finally {
            setLoading(false);
        }
    }

    return (
        <AuthPageLayout
            label='Create admin account'
            header={
                <Stack gap={4}>
                    <Title order={2} size='h3'>
                        Create admin account
                    </Title>
                    <Text size='sm' c='dimmed'>
                        Administrators manage NAS devices, packages, customers
                        and payments.
                    </Text>
                </Stack>
            }
        >
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
                        inputMode='email'
                        autoCapitalize='none'
                        autoComplete='username'
                        required
                        {...form.getInputProps('email')}
                    />
                    <PasswordInput
                        label='Password'
                        visibilityToggleButtonProps={{
                            'aria-label': 'Toggle password visibility',
                        }}
                        autoComplete='new-password'
                        required
                        description='At least 8 characters, combining 2 of: lowercase, uppercase, numbers, symbols'
                        {...form.getInputProps('password')}
                    />
                    <PasswordInput
                        label='Confirm password'
                        visibilityToggleButtonProps={{
                            'aria-label': 'Toggle confirm password visibility',
                        }}
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
        </AuthPageLayout>
    );
}
