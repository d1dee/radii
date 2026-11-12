import {
    Alert,
    Badge,
    Button,
    Group,
    Loader,
    Paper,
    PasswordInput,
    Stack,
    Table,
    Text,
    Title,
} from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { authClient } from './auth';
import { PageTableScrollContainer } from './components/PageTableScrollContainer';
import { RecordDetails } from './RecordDetails';

type Session = NonNullable<
    Awaited<ReturnType<typeof authClient.listSessions>>['data']
>[number];

function securityError(
    error: { status?: number; code?: string },
    fallback: string,
) {
    if (error.status === 401 || error.code === 'SESSION_EXPIRED') {
        return 'Your session has expired. Sign in again to manage account security.';
    }
    if (error.status === 429)
        return 'Too many requests. Wait a moment before trying again.';
    if (error.code === 'INVALID_PASSWORD')
        return 'Your current password is incorrect.';
    if (error.code === 'SESSION_NOT_FRESH')
        return 'Sign in again before making this security change.';
    return fallback;
}

function sessionDate(value: Date | string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Unavailable' : date.toLocaleString();
}

export function AccountSecurity() {
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmation, setConfirmation] = useState('');
    const [sessions, setSessions] = useState<Session[]>([]);
    const [currentId, setCurrentId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<string | null>(null);
    const [passwordError, setPasswordError] = useState('');
    const [sessionError, setSessionError] = useState('');
    const [message, setMessage] = useState('');
    const requestVersion = useRef(0);
    const actionPending = useRef(false);

    async function refresh() {
        const version = ++requestVersion.current;
        setLoading(true);
        setSessionError('');
        // Never allow actions against a stale list or an unidentified current session.
        setSessions([]);
        setCurrentId(null);
        try {
            const [current, listed] = await Promise.all([
                authClient.getSession({
                    query: { disableCookieCache: true },
                    fetchOptions: { cache: 'no-store' },
                }),
                authClient.listSessions({
                    fetchOptions: { cache: 'no-store' },
                }),
            ]);
            if (version !== requestVersion.current) return;
            if (current.error || listed.error) {
                setSessionError(
                    securityError(
                        current.error || listed.error || {},
                        'Sessions could not be loaded. Refresh to try again.',
                    ),
                );
            } else if (!current.data) {
                setSessionError(
                    'Your session has expired. Sign in again to manage account security.',
                );
            } else {
                setCurrentId(current.data.session.id);
                setSessions(
                    (listed.data || []).filter(
                        (session) =>
                            new Date(session.expiresAt).getTime() > Date.now(),
                    ),
                );
            }
        } catch {
            if (version === requestVersion.current)
                setSessionError(
                    'Cannot reach the authentication service. Check your connection and refresh.',
                );
        } finally {
            if (version === requestVersion.current) setLoading(false);
        }
    }

    useEffect(() => {
        void refresh();
        return () => {
            requestVersion.current++;
        };
    }, []);

    async function changePassword(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (actionPending.current) return;
        setPasswordError('');
        setMessage('');
        if (!currentPassword) {
            setPasswordError('Enter your current password.');
            return;
        }
        if (newPassword.length < 12 || newPassword.length > 128) {
            setPasswordError(
                'Your new password must contain 12 to 128 characters.',
            );
            return;
        }
        if (newPassword !== confirmation) {
            setPasswordError('The new passwords do not match.');
            return;
        }
        actionPending.current = true;
        setBusy('password');
        try {
            const result = await authClient.changePassword({
                currentPassword,
                newPassword,
                revokeOtherSessions: true,
            });
            if (result.error) {
                setPasswordError(
                    securityError(
                        result.error,
                        'Password could not be changed. Check your current password and try again.',
                    ),
                );
                return;
            }
            setCurrentPassword('');
            setNewPassword('');
            setConfirmation('');
            setMessage(
                'Password changed. Other sessions have been signed out.',
            );
            // Better Auth can rotate the current session during a password change.
            await refresh();
        } catch {
            setPasswordError(
                'The password change could not be confirmed. Check your connection and sign in again if needed.',
            );
        } finally {
            actionPending.current = false;
            setBusy(null);
        }
    }

    async function revoke(session?: Session) {
        if (
            actionPending.current ||
            loading ||
            !currentId ||
            (session && session.id === currentId)
        )
            return;
        actionPending.current = true;
        setBusy(session?.id || 'others');
        setSessionError('');
        setMessage('');
        try {
            // Tokens are used only for Better Auth revocation, never rendered or logged.
            const result = session
                ? await authClient.revokeSession({ token: session.token })
                : await authClient.revokeOtherSessions();
            if (!result.error) {
                setMessage(
                    session
                        ? 'Session signed out.'
                        : 'All other sessions have been signed out.',
                );
            }
            await refresh();
            if (result.error)
                setSessionError(
                    securityError(
                        result.error,
                        'Sessions could not be signed out. Refresh before trying again.',
                    ),
                );
        } catch {
            await refresh();
            setSessionError(
                'Sign-out could not be confirmed. Check your connection and refresh before retrying.',
            );
        } finally {
            actionPending.current = false;
            setBusy(null);
        }
    }

    const otherSessions = sessions.filter(
        (session) => session.id !== currentId,
    );
    return (
        <Stack gap='lg' miw={0}>
            <div>
                <Title order={2} size='h3'>
                    Account security
                </Title>
                <Text size='sm' c='dimmed'>
                    Manage your password and signed-in devices.
                </Text>
            </div>
            {message && (
                <Alert color='green' role='status'>
                    {message}
                </Alert>
            )}
            <Paper withBorder p={{ base: 'sm', sm: 'md' }}>
                <Stack gap='sm'>
                    <Title order={3} size='h4'>
                        Change password
                    </Title>
                    <Text size='sm' c='dimmed'>
                        Changing your password signs out every other session.
                        This device stays signed in.
                    </Text>
                    {passwordError && (
                        <Alert color='red' role='alert'>
                            {passwordError}
                        </Alert>
                    )}
                    <form onSubmit={changePassword}>
                        <Stack gap='xs' maw={520}>
                            <PasswordInput
                                pb='xs'
                                label='Current password'
                                autoComplete='current-password'
                                required
                                maxLength={128}
                                value={currentPassword}
                                disabled={busy !== null}
                                onChange={(event) =>
                                    setCurrentPassword(
                                        event.currentTarget.value,
                                    )
                                }
                            />
                            <PasswordInput
                                pb='xs'
                                label='New password'
                                autoComplete='new-password'
                                description='Use 12 to 128 characters and a password you do not use elsewhere.'
                                inputWrapperOrder={[
                                    'label',
                                    'input',
                                    'description',
                                    'error',
                                ]}
                                descriptionProps={{ pb: 'xs', mt: 'xs' }}
                                required
                                minLength={12}
                                maxLength={128}
                                value={newPassword}
                                disabled={busy !== null}
                                onChange={(event) =>
                                    setNewPassword(event.currentTarget.value)
                                }
                            />
                            <PasswordInput
                                pb='xs'
                                label='Confirm new password'
                                autoComplete='new-password'
                                required
                                minLength={12}
                                maxLength={128}
                                value={confirmation}
                                disabled={busy !== null}
                                onChange={(event) =>
                                    setConfirmation(event.currentTarget.value)
                                }
                            />
                            <Group>
                                <Button
                                    type='submit'
                                    loading={busy === 'password'}
                                    disabled={busy !== null}
                                >
                                    Change password
                                </Button>
                            </Group>
                        </Stack>
                    </form>
                </Stack>
            </Paper>
            <Paper withBorder p={{ base: 'sm', sm: 'md' }} miw={0}>
                <Stack gap='sm' miw={0}>
                    <Group justify='space-between' wrap='wrap'>
                        <Title order={3} size='h4'>
                            Active sessions
                        </Title>
                        <Group gap='xs' wrap='wrap'>
                            <Button
                                variant='default'
                                size='xs'
                                loading={loading}
                                disabled={busy !== null || loading}
                                onClick={() => void refresh()}
                            >
                                Refresh sessions
                            </Button>
                            <Button
                                color='red'
                                variant='light'
                                size='xs'
                                loading={busy === 'others'}
                                disabled={
                                    busy !== null ||
                                    loading ||
                                    !currentId ||
                                    !otherSessions.length
                                }
                                onClick={() => void revoke()}
                            >
                                Sign out all other sessions
                            </Button>
                        </Group>
                    </Group>
                    <Text size='sm' c='dimmed'>
                        Review devices you recognize and sign out any others.
                        Device and IP details are reported by the connection and
                        may be unavailable. Updated time is not a complete
                        activity history.
                    </Text>
                    {sessionError && (
                        <Alert color='red' role='alert'>
                            {sessionError}
                        </Alert>
                    )}
                    {loading ? (
                        <Group role='status'>
                            <Loader size='sm' />
                            <Text size='sm'>Loading sessions...</Text>
                        </Group>
                    ) : sessions.length ? (
                        <PageTableScrollContainer
                            minWidth={700}
                            w='100%'
                            role='region'
                            aria-label='Active sessions'
                            tabIndex={0}
                        >
                            <Table withRowBorders highlightOnHover>
                                <Table.Thead>
                                    <Table.Tr>
                                        <Table.Th>Device / browser</Table.Th>
                                        <Table.Th>IP address</Table.Th>
                                        <Table.Th>Session details</Table.Th>
                                        <Table.Th>Details</Table.Th>
                                        <Table.Th>Action</Table.Th>
                                    </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                    {sessions.map((session) => (
                                        <Table.Tr key={session.id}>
                                            <Table.Td maw={320}>
                                                <Text
                                                    size='sm'
                                                    style={{
                                                        overflowWrap:
                                                            'anywhere',
                                                    }}
                                                >
                                                    {session.userAgent ||
                                                        'Unknown device / browser'}
                                                </Text>
                                                {session.id === currentId && (
                                                    <Badge
                                                        color='green'
                                                        size='sm'
                                                        mt='xs'
                                                    >
                                                        Current session
                                                    </Badge>
                                                )}
                                            </Table.Td>
                                            <Table.Td>
                                                <Text size='sm'>
                                                    {session.ipAddress ||
                                                        'Unavailable'}
                                                </Text>
                                            </Table.Td>
                                            <Table.Td>
                                                <Text size='xs'>
                                                    Signed in:{' '}
                                                    {sessionDate(
                                                        session.createdAt,
                                                    )}
                                                </Text>
                                                <Text size='xs'>
                                                    Updated:{' '}
                                                    {sessionDate(
                                                        session.updatedAt,
                                                    )}
                                                </Text>
                                                <Text size='xs'>
                                                    Expires:{' '}
                                                    {sessionDate(
                                                        session.expiresAt,
                                                    )}
                                                </Text>
                                            </Table.Td>
                                            <Table.Td>
                                                <RecordDetails
                                                    title='Session details'
                                                    fields={[
                                                        [
                                                            'Device / browser',
                                                            session.userAgent,
                                                        ],
                                                        [
                                                            'IP address',
                                                            session.ipAddress,
                                                        ],
                                                        [
                                                            'Signed in',
                                                            sessionDate(
                                                                session.createdAt,
                                                            ),
                                                        ],
                                                        [
                                                            'Updated',
                                                            sessionDate(
                                                                session.updatedAt,
                                                            ),
                                                        ],
                                                        [
                                                            'Expires',
                                                            sessionDate(
                                                                session.expiresAt,
                                                            ),
                                                        ],
                                                        [
                                                            'Session',
                                                            session.id ===
                                                            currentId
                                                                ? 'Current session'
                                                                : 'Other signed-in session',
                                                        ],
                                                    ]}
                                                />
                                            </Table.Td>
                                            <Table.Td>
                                                {session.id === currentId ? (
                                                    <Text size='sm' c='dimmed'>
                                                        This device
                                                    </Text>
                                                ) : (
                                                    <Button
                                                        size='xs'
                                                        color='red'
                                                        variant='light'
                                                        loading={
                                                            busy === session.id
                                                        }
                                                        disabled={
                                                            busy !== null ||
                                                            !currentId
                                                        }
                                                        onClick={() =>
                                                            void revoke(session)
                                                        }
                                                        aria-label={`Sign out session from ${session.ipAddress || 'unknown IP address'}`}
                                                    >
                                                        Sign out
                                                    </Button>
                                                )}
                                            </Table.Td>
                                        </Table.Tr>
                                    ))}
                                </Table.Tbody>
                            </Table>
                        </PageTableScrollContainer>
                    ) : !sessionError ? (
                        <Text size='sm' c='dimmed'>
                            No active sessions to show. Refresh to check again.
                        </Text>
                    ) : null}
                </Stack>
            </Paper>
        </Stack>
    );
}
