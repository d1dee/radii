import {
    Alert,
    Anchor,
    Button,
    Group,
    Paper,
    PasswordInput,
    Stack,
    Text,
    TextInput,
    Title,
} from '@mantine/core';
import { useState } from 'react';
import { authClient } from './auth';

type Mode =
    | 'login'
    | 'register'
    | 'verify-email'
    | 'forgot-password'
    | 'reset-password';
const titles: Record<Mode, string> = {
    login: 'Sign in to your agent account',
    register: 'Create an agent account',
    'verify-email': 'Verify your email',
    'forgot-password': 'Reset your password',
    'reset-password': 'Choose a new password',
};
export function AuthPage({
    mode,
    initialEmail = '',
}: {
    mode: Mode;
    initialEmail?: string;
}) {
    const [email, setEmail] = useState(initialEmail);
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [otp, setOtp] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    async function act(action: 'submit' | 'resend') {
        if (busy) return;
        setError('');
        setMessage('');
        if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
            setError('Enter a valid email address.');
            return;
        }
        if (
            (mode === 'register' || mode === 'reset-password') &&
            password !== confirmPassword
        ) {
            setError('Passwords do not match.');
            return;
        }
        setBusy(true);
        try {
            const address = email.trim();
            const result =
                action === 'resend'
                    ? await authClient.emailOtp.sendVerificationOtp({
                          email: address,
                          type: 'email-verification',
                      })
                    : mode === 'login'
                      ? await authClient.signIn.email({
                            email: address,
                            password,
                        })
                      : mode === 'register'
                        ? await authClient.signUp.email({
                              email: address,
                              password,
                              name: name.trim(),
                          })
                        : mode === 'verify-email'
                          ? await authClient.emailOtp.verifyEmail({
                                email: address,
                                otp: otp.trim(),
                            })
                          : mode === 'forgot-password'
                            ? await authClient.emailOtp.requestPasswordReset({
                                  email: address,
                              })
                            : await authClient.emailOtp.resetPassword({
                                  email: address,
                                  otp: otp.trim(),
                                  password,
                              });
            if (result.error) {
                if (result.error.code === 'EMAIL_NOT_VERIFIED') {
                    window.location.assign(
                        `/verify-email?email=${encodeURIComponent(address)}`,
                    );
                    return;
                }
                setError(
                    result.error.message ||
                        'The request could not be completed. Try again.',
                );
                return;
            }
            if (action === 'resend')
                setMessage(
                    'A new verification code has been requested. Check your email.',
                );
            else if (mode === 'login') window.location.assign('/');
            else if (mode === 'register')
                window.location.assign(
                    `/verify-email?email=${encodeURIComponent(address)}`,
                );
            else if (mode === 'forgot-password')
                window.location.assign(
                    `/reset-password?email=${encodeURIComponent(address)}`,
                );
            else if (mode === 'reset-password') {
                setPassword('');
                setConfirmPassword('');
                setMessage(
                    'Password updated. Sign in using your new password.',
                );
            } else {
                setOtp('');
                setMessage(
                    'Email verified. Sign in to check your account access.',
                );
                await authClient.getSession({
                    query: { disableCookieCache: true },
                });
            }
        } catch {
            setError(
                'Cannot reach the authentication service. Check your connection and try again.',
            );
        } finally {
            setBusy(false);
        }
    }
    return (
        <Paper className='auth-panel' p={{ base: 'md', sm: 'xl' }} withBorder>
            <Stack gap='lg'>
                <div>
                    <Title order={2} size='h3'>
                        {titles[mode]}
                    </Title>
                    <Text size='sm' c='dimmed' mt='xs'>
                        {mode === 'register'
                            ? 'Registration does not grant access to commissions. Your operator must link and approve your verified email.'
                            : mode === 'verify-email'
                              ? 'Enter the six-digit code sent to your email. Verification alone does not approve accounting access.'
                              : mode === 'login'
                                ? 'View your commissions and request manually processed withdrawals.'
                                : 'Use your registered agent email. If an account exists, a reset code will be sent.'}
                    </Text>
                </div>
                {error && (
                    <Alert color='red' role='alert'>
                        {error}
                    </Alert>
                )}
                {message && (
                    <Alert color='blue' role='status'>
                        {message}
                    </Alert>
                )}
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        void act('submit');
                    }}
                >
                    <Stack gap='xs'>
                        {mode === 'register' && (
                            <TextInput
                                pb='xs'
                                label='Your name'
                                autoComplete='name'
                                required
                                maxLength={200}
                                value={name}
                                onChange={(event) =>
                                    setName(event.currentTarget.value)
                                }
                            />
                        )}
                        <TextInput
                            pb='xs'
                            label='Email'
                            type='email'
                            autoComplete='email'
                            required
                            maxLength={254}
                            value={email}
                            onChange={(event) =>
                                setEmail(event.currentTarget.value)
                            }
                        />
                        {(mode === 'verify-email' ||
                            mode === 'reset-password') && (
                            <TextInput
                                pb='xs'
                                label='Email code'
                                autoComplete='one-time-code'
                                inputMode='numeric'
                                pattern='[0-9]{6}'
                                minLength={6}
                                maxLength={6}
                                required
                                value={otp}
                                onChange={(event) =>
                                    setOtp(event.currentTarget.value)
                                }
                            />
                        )}
                        {(mode === 'login' ||
                            mode === 'register' ||
                            mode === 'reset-password') && (
                            <PasswordInput
                                pb='xs'
                                label={
                                    mode === 'reset-password'
                                        ? 'New password'
                                        : 'Password'
                                }
                                autoComplete={
                                    mode === 'login'
                                        ? 'current-password'
                                        : 'new-password'
                                }
                                required
                                minLength={mode === 'login' ? undefined : 12}
                                description={
                                    mode === 'login'
                                        ? undefined
                                        : 'Use 12 to 128 characters.'
                                }
                                maxLength={128}
                                value={password}
                                onChange={(event) =>
                                    setPassword(event.currentTarget.value)
                                }
                            />
                        )}
                        {(mode === 'register' || mode === 'reset-password') && (
                            <PasswordInput
                                pb='xs'
                                label='Confirm password'
                                autoComplete='new-password'
                                required
                                minLength={12}
                                maxLength={128}
                                value={confirmPassword}
                                onChange={(event) =>
                                    setConfirmPassword(
                                        event.currentTarget.value,
                                    )
                                }
                            />
                        )}
                        <Button type='submit' fullWidth loading={busy}>
                            {mode === 'login'
                                ? 'Sign in'
                                : mode === 'register'
                                  ? 'Create account'
                                  : mode === 'verify-email'
                                    ? 'Verify email'
                                    : mode === 'forgot-password'
                                      ? 'Send reset code'
                                      : 'Update password'}
                        </Button>
                        {mode === 'verify-email' && (
                            <Button
                                variant='default'
                                disabled={busy}
                                onClick={() => void act('resend')}
                            >
                                Resend verification code
                            </Button>
                        )}
                    </Stack>
                </form>
                <Group justify='space-between' gap='xs'>
                    <Anchor size='sm' href='/login'>
                        Sign in
                    </Anchor>
                    {mode === 'login' && (
                        <Anchor size='sm' href='/register'>
                            Create account
                        </Anchor>
                    )}
                    <Anchor size='sm' href='/forgot-password'>
                        Forgot password
                    </Anchor>
                </Group>
            </Stack>
        </Paper>
    );
}
