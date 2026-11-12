import {
    Alert,
    Anchor,
    Badge,
    Button,
    Group,
    Loader,
    Paper,
    Select,
    Stack,
    Text,
    Title,
} from '@mantine/core';
import { lazy, Suspense, useEffect, useState } from 'react';
import { authClient } from './auth';
import { AuthPage } from './AuthPage';
import { request, type Membership } from './api';
import {
    accountViews,
    PortalLayout,
    type AccountView,
} from './components/PortalLayout';
import { PageLayout } from './components/PageLayout';
const AccountSecurity = lazy(() =>
    import('./AccountSecurity').then((module) => ({
        default: module.AccountSecurity,
    })),
);
const Dashboard = lazy(() =>
    import('./Dashboard').then((module) => ({ default: module.Dashboard })),
);

export default function App() {
    const {
        data: session,
        isPending,
        error: sessionError,
    } = authClient.useSession();
    const [logoutError, setLogoutError] = useState('');
    const [loggingOut, setLoggingOut] = useState(false);
    const [hasAccount, setHasAccount] = useState(false);
    const [view, setView] = useState<AccountView>(
        () =>
            accountViews.find(
                (item) => `#${item.value}` === window.location.hash,
            )?.value || 'statement',
    );
    useEffect(() => {
        const updateView = () =>
            setView(
                accountViews.find(
                    (item) => `#${item.value}` === window.location.hash,
                )?.value || 'statement',
            );
        window.addEventListener('hashchange', updateView);
        return () => window.removeEventListener('hashchange', updateView);
    }, []);
    const path = window.location.pathname.replace(/\/$/, '') || '/';
    const authMode = [
        'login',
        'register',
        'verify-email',
        'forgot-password',
        'reset-password',
    ].find((mode) => path === `/${mode}`) as
        | 'login'
        | 'register'
        | 'verify-email'
        | 'forgot-password'
        | 'reset-password'
        | undefined;
    async function logout() {
        setLoggingOut(true);
        setLogoutError('');
        try {
            const result = await authClient.signOut();
            if (result.error) throw new Error('Sign out failed. Please retry.');
            window.location.assign('/login');
        } catch {
            setLogoutError(
                'Could not sign out. Check your connection and retry.',
            );
        } finally {
            setLoggingOut(false);
        }
    }
    return (
        <PortalLayout
            user={session?.user}
            hasAccount={
                hasAccount &&
                !!session?.user.emailVerified &&
                !authMode &&
                !sessionError
            }
            view={view}
            onView={setView}
            onLogout={() => void logout()}
            loggingOut={loggingOut}
        >
            {logoutError && (
                <Alert mb='md' color='red' role='alert'>
                    {logoutError}
                </Alert>
            )}
            {isPending ? (
                <Stack align='center' py='xl'>
                    <Loader aria-label='Checking agent session' />
                    <Text>Checking your agent session...</Text>
                </Stack>
            ) : authMode ? (
                <AuthPage
                    key={authMode}
                    mode={authMode}
                    initialEmail={
                        session?.user.email ||
                        new URLSearchParams(window.location.search).get(
                            'email',
                        ) ||
                        ''
                    }
                />
            ) : sessionError ? (
                <Alert color='red' role='alert'>
                    Cannot check your session. No account information has been
                    loaded.
                    <Button
                        variant='subtle'
                        onClick={() => window.location.reload()}
                    >
                        Retry
                    </Button>
                    <Anchor href='/login'>Sign in</Anchor>
                </Alert>
            ) : !session ? (
                <AuthPage mode='login' />
            ) : !session.user.emailVerified ? (
                <Paper p='xl' withBorder>
                    <Stack>
                        <Title order={2}>Verify your email first</Title>
                        <Text>
                            Commission access requires a verified email and a
                            membership approved by your operator.
                        </Text>
                        <Anchor href='/verify-email'>Verify email</Anchor>
                    </Stack>
                </Paper>
            ) : view === 'security' ? (
                <PageLayout header={null}>
                    <Suspense
                        fallback={
                            <Loader aria-label='Loading account security' />
                        }
                    >
                        <AccountSecurity />
                    </Suspense>
                </PageLayout>
            ) : (
                <Memberships
                    key={session.user.id}
                    userId={session.user.id}
                    view={view}
                    onReady={setHasAccount}
                />
            )}
        </PortalLayout>
    );
}

function Memberships({
    userId,
    view,
    onReady,
}: {
    userId: string;
    view: AccountView;
    onReady: (ready: boolean) => void;
}) {
    const [memberships, setMemberships] = useState<Membership[] | null>(null);
    const [selected, setSelected] = useState<string | null>(null);
    const [error, setError] = useState('');
    const [revision, setRevision] = useState(0);
    useEffect(() => {
        const controller = new AbortController();
        setMemberships(null);
        setError('');
        onReady(false);
        request<{ items: Membership[] }>(
            '/memberships',
            undefined,
            controller.signal,
        )
            .then((data) => {
                if (controller.signal.aborted) return;
                setMemberships(data.items);
                onReady(data.items.length > 0);
                setSelected((current) =>
                    data.items.some((item) => item.agentId === current)
                        ? current
                        : data.items[0]?.agentId || null,
                );
            })
            .catch((err) => {
                if (!controller.signal.aborted) setError(err.message);
            });
        return () => controller.abort();
    }, [revision, onReady]);
    if (error)
        return (
            <Alert color='red' role='alert'>
                {error}
                <Group mt='sm'>
                    <Button
                        variant='default'
                        onClick={() => setRevision((value) => value + 1)}
                    >
                        Retry access check
                    </Button>
                    <Anchor href='/login'>Sign in again</Anchor>
                </Group>
            </Alert>
        );
    if (!memberships)
        return <Loader aria-label='Checking approved memberships' />;
    if (!memberships.length)
        return (
            <Paper withBorder p={{ base: 'md', sm: 'xl' }}>
                <Stack>
                    <Badge color='orange' variant='filled' w='fit-content'>
                        Awaiting operator approval
                    </Badge>
                    <Title order={2}>Your account is registered</Title>
                    <Text maw={650}>
                        No approved agent membership is available. Ask your
                        operator to link your verified email to your agent
                        record. Registration and email verification do not
                        create commission rights or approve withdrawals.
                    </Text>
                    <Text size='sm' c='dimmed'>
                        Previously had access? Your operator may have revoked
                        the membership or archived the agent record. Contact
                        them to review access. Balances remain protected.
                    </Text>
                    <Button
                        variant='default'
                        w='fit-content'
                        onClick={() => setRevision((value) => value + 1)}
                    >
                        Check approval status
                    </Button>
                </Stack>
            </Paper>
        );
    const membership = memberships.find((item) => item.agentId === selected);
    return (
        <Stack gap='md' className='portal-memberships'>
            {memberships.length > 1 && (
                <Select
                    pb='xs'
                    label='Agent membership'
                    data={memberships.map((item) => ({
                        value: item.agentId,
                        label: `${item.name} (${item.tenantName})`,
                    }))}
                    value={selected}
                    allowDeselect={false}
                    onChange={setSelected}
                />
            )}
            {membership && (
                <Suspense
                    fallback={<Loader aria-label='Loading accounting views' />}
                >
                    <Dashboard
                        key={`${membership.agentId}:${view}`}
                        userId={userId}
                        membership={membership}
                        tab={view}
                    />
                </Suspense>
            )}
        </Stack>
    );
}
