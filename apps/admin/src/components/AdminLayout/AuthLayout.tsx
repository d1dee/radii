import { authClient } from '@/lib/auth-client';
import { Center, Loader } from '@mantine/core';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

interface AuthLayoutProps {
    children: React.ReactNode;
}

export function AuthLayout({ children }: AuthLayoutProps) {
    const navigate = useNavigate();
    const { useSession } = authClient;
    const { data: session, isPending } = useSession();

    const user = session?.user;
    const role = (user?.role as string | undefined) ?? '';
    const isAdmin = role === 'admin';

    useEffect(() => {
        if (!isPending && (!user || !isAdmin)) {
            navigate('/login');
        }
    }, [isPending, user, isAdmin, navigate]);

    if (isPending) {
        return (
            <Center h='100vh'>
                <Loader />
            </Center>
        );
    }

    if (!user || !isAdmin) {
        return null;
    }

    return <>{children}</>;
}
