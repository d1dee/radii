import { Center, Loader, Stack, Text } from '@mantine/core';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { useSession } from '@/lib/auth';

// Gates the whole admin console on a session from the ADMIN auth instance.
// - unauthenticated -> /login
// - authenticated but email not verified -> /verify-email (admins must prove
//   mailbox ownership with a 2FA-style OTP code before console access)
export function RequireAdmin({ children }: { children: ReactNode }) {
    const { data: session, isPending } = useSession();
    const location = useLocation();

    if (isPending) {
        return (
            <Center mih='100vh'>
                <Stack align='center' gap='xs'>
                    <Loader />
                    <Text size='sm' c='dimmed'>
                        Checking admin session…
                    </Text>
                </Stack>
            </Center>
        );
    }

    if (!session) {
        return (
            <Navigate
                to='/login'
                replace
                state={{ from: location.pathname + location.search }}
            />
        );
    }

    if (!session.user.emailVerified) {
        return (
            <Navigate
                to='/verify-email'
                replace
                state={{ email: session.user.email }}
            />
        );
    }

    return <>{children}</>;
}
