import {
    Anchor,
    Button,
    Group,
    PinInput,
    Stack,
    Text,
    TextInput,
    Title,
} from '@mantine/core';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { authClient, useSession } from '@/lib/auth';
import { reportClientError } from '@/lib/clientError';
import { AuthPageLayout } from '@/components/Layout/AuthPageLayout';
import { notifications } from '@mantine/notifications';

// 2FA-style email verification for admin accounts: the admin registers (or
// attempts to sign in while unverified), the server emails a 6-digit code
// valid for 5 minutes, and this screen redeems it. On success the server
// opens a console session automatically (autoSignInAfterVerification) and
// the effect below enters the console once it arrives.
export default function VerifyEmailPage() {
    const navigate = useNavigate();
    const location = useLocation();
    const { data: session } = useSession();
    const state = location.state as { email?: string } | null;

    const [email, setEmail] = useState(
        session?.user.email ?? state?.email ?? '',
    );
    const [otp, setOtp] = useState('');
    const [verifying, setVerifying] = useState(false);
    const [resending, setResending] = useState(false);

    // Session became verified (sign-up flow, or auto sign-in after the OTP
    // check) -> enter the console.
    useEffect(() => {
        if (session?.user.emailVerified) {
            navigate('/', { replace: true });
        }
    }, [session?.user.emailVerified, navigate]);

    const emailValid = /^\S+@\S+\.\S+$/.test(email);
    const canVerify = emailValid && otp.length === 6;

    async function resend() {
        setResending(true);
        try {
            const { error } = await authClient.emailOtp.sendVerificationOtp({
                email,
                type: 'email-verification',
            });
            if (error) {
                notifications.show({
                    color: 'red',
                    message: error.message || 'Could not send a new code',
                });
                return;
            }
            notifications.show({
                color: 'blue',
                message: 'A new 6-digit code is on its way',
            });
        } catch (error) {
            notifications.show({
                color: 'red',
                message: reportClientError(
                    error,
                    'resend admin verification code',
                    'A new verification code could not be sent. Try again.',
                ),
            });
        } finally {
            setResending(false);
        }
    }

    async function verify() {
        setVerifying(true);
        try {
            const { error } = await authClient.emailOtp.verifyEmail({
                email,
                otp,
            });
            if (error) {
                notifications.show({
                    color: 'red',
                    message: error.message || 'Verification failed',
                });
                setOtp('');
                return;
            }
            setOtp('');
            notifications.show({
                color: 'green',
                message: 'Email verified',
            });
            // The session effect above navigates once the verified session
            // lands; if no session materialises, fall back to the login page.
            setTimeout(() => {
                if (!session?.user.emailVerified) {
                    navigate('/login', { replace: true });
                }
            }, 2500);
        } catch (error) {
            notifications.show({
                color: 'red',
                message: reportClientError(
                    error,
                    'verify admin email',
                    'Email verification could not be completed. Try again.',
                ),
            });
            setOtp('');
        } finally {
            setVerifying(false);
        }
    }

    return (
        <AuthPageLayout
            label='Email verification'
            header={
                <Stack gap={4}>
                    <Title order={2} size='h3'>
                        Verify your email
                    </Title>
                    <Text size='sm' c='dimmed'>
                        Enter the 6-digit code we emailed you. It expires in 5
                        minutes.
                    </Text>
                </Stack>
            }
        >
            <Stack gap='md'>
                <TextInput
                    label='Email'
                    type='email'
                    inputMode='email'
                    autoComplete='email'
                    autoCapitalize='none'
                    required
                    disabled={!!session}
                    value={email}
                    onChange={(e) => setEmail(e.currentTarget.value)}
                />
                <Stack gap={4} align='center'>
                    <Text size='sm' fw={500}>
                        Verification code
                    </Text>
                    <PinInput
                        size='sm'
                        gap={6}
                        inputMode='numeric'
                        oneTimeCode
                        length={6}
                        ariaLabel='6-digit verification code'
                        value={otp}
                        onChange={setOtp}
                    />
                </Stack>
                <Button
                    fullWidth
                    loading={verifying}
                    disabled={!canVerify}
                    onClick={verify}
                >
                    Verify email
                </Button>
                <Group justify='space-between'>
                    <Button
                        variant='subtle'
                        size='sm'
                        px='xs'
                        onClick={resend}
                        loading={resending}
                        disabled={!emailValid}
                    >
                        Resend code
                    </Button>
                    <Anchor component={Link} to='/login' size='sm'>
                        Back to sign in
                    </Anchor>
                </Group>
            </Stack>
        </AuthPageLayout>
    );
}
