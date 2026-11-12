import {
    Alert,
    Badge,
    Button,
    Card,
    Center,
    Checkbox,
    Code,
    Group,
    Loader,
    Modal,
    Stack,
    Text,
    Textarea,
    TextInput,
} from '@mantine/core';
import { useEffect, useState } from 'react';
import {
    getAgentPortalAccess,
    linkAgentPortalAccess,
    revokeAgentPortalAccess,
    verifyAgentPayoutProfile,
    type Agent,
    type AgentPayoutProfile,
    type AgentPortalAccess as PortalAccess,
} from '@/lib/accountingApi';
import { formatDateTime } from '@/lib/format';

type Action =
    | { kind: 'link' }
    | { kind: 'revoke' }
    | { kind: 'verify'; profile: AgentPayoutProfile };

export function AgentPortalAccess({
    agent,
    onDialogChange,
}: {
    agent: Agent;
    onDialogChange?: (opened: boolean) => void;
}) {
    const [data, setData] = useState<PortalAccess | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [revision, setRevision] = useState(0);
    const [action, setAction] = useState<Action | null>(null);
    const [email, setEmail] = useState('');
    const [evidence, setEvidence] = useState('');
    const [confirmed, setConfirmed] = useState(false);
    const [busy, setBusy] = useState(false);
    const [actionError, setActionError] = useState('');
    const [notice, setNotice] = useState('');
    const dialogOpen = !!action;
    useEffect(() => {
        onDialogChange?.(dialogOpen);
        return () => onDialogChange?.(false);
    }, [dialogOpen, onDialogChange]);
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError('');
        void getAgentPortalAccess(agent.id).then((result) => {
            if (cancelled) return;
            setLoading(false);
            if (!result.success || !result.data) {
                setData(null);
                setError(
                    result.success
                        ? 'The server returned no portal access details.'
                        : result.message,
                );
                return;
            }
            setData(result.data);
        });
        return () => {
            cancelled = true;
        };
    }, [agent.id, revision]);
    const membership = data?.membership;
    const profile = data?.payoutProfile;
    function open(next: Action) {
        setEmail(membership?.email ?? '');
        setEvidence('');
        setConfirmed(false);
        setActionError('');
        setAction(next);
    }
    async function submit(event: React.FormEvent) {
        event.preventDefault();
        if (!action || busy || !confirmed) return;
        if (action.kind === 'verify' && !evidence.trim()) {
            setActionError(
                'Record how the account holder and exact destination were independently verified.',
            );
            return;
        }
        setBusy(true);
        setActionError('');
        const result =
            action.kind === 'link'
                ? await linkAgentPortalAccess(
                      agent.id,
                      membership?.email ?? email.trim(),
                  )
                : action.kind === 'revoke'
                  ? await revokeAgentPortalAccess(agent.id)
                  : await verifyAgentPayoutProfile(
                        agent.id,
                        action.profile.id,
                        evidence.trim(),
                    );
        setBusy(false);
        if (!result.success || !result.data) {
            setActionError(
                result.success
                    ? 'No confirmation returned. Refresh portal access to check the current state before retrying.'
                    : result.message,
            );
            return;
        }
        setNotice(
            action.kind === 'verify'
                ? 'Payout destination version verified. No money was transferred.'
                : action.kind === 'revoke'
                  ? 'Portal access revoked. Financial records are retained.'
                  : 'Registered identity linked. Portal access is active.',
        );
        setAction(null);
        setRevision((value) => value + 1);
    }
    const title =
        action?.kind === 'verify'
            ? 'Verify payout destination'
            : action?.kind === 'revoke'
              ? 'Revoke portal access'
              : membership
                ? 'Reactivate portal access'
                : 'Link registered agent';
    return (
        <Stack>
            <Text size='sm' c='dimmed'>
                Registration alone grants no access. Link a verified registered
                email only after independently confirming the agent identity.
                There are no automatic invitations or pending access requests.
            </Text>
            {notice && (
                <Alert color='green' role='status'>
                    {notice}
                </Alert>
            )}
            <Button
                variant='default'
                w='max-content'
                disabled={loading || busy}
                onClick={() => setRevision((value) => value + 1)}
            >
                Refresh portal access
            </Button>
            {loading ? (
                <Center py='lg'>
                    <Loader aria-label='Loading portal access' />
                </Center>
            ) : error ? (
                <Alert color='red' role='alert'>
                    {error}
                    <Button
                        variant='subtle'
                        onClick={() => setRevision((value) => value + 1)}
                    >
                        Retry portal access
                    </Button>
                </Alert>
            ) : data ? (
                <>
                    <Card withBorder>
                        <Stack gap='sm'>
                            <Group>
                                <Text fw={600}>Registered identity</Text>
                                <Badge
                                    color={
                                        membership?.status === 'active'
                                            ? 'green'
                                            : 'orange'
                                    }
                                >
                                    {membership?.status ?? 'Not linked'}
                                </Badge>
                            </Group>
                            {membership ? (
                                <>
                                    <Text style={{ overflowWrap: 'anywhere' }}>
                                        {membership.name} ({membership.email})
                                    </Text>
                                    <Text size='xs'>
                                        Auth identity:{' '}
                                        <Code>{membership.userId}</Code>
                                    </Text>
                                    <Text size='xs' c='dimmed'>
                                        Updated{' '}
                                        {formatDateTime(membership.updatedAt)}
                                    </Text>
                                    <Text size='sm'>
                                        This accounting agent is permanently
                                        linked to this login. Revocation does
                                        not permit transfer to a different
                                        identity.
                                    </Text>
                                </>
                            ) : (
                                <Text size='sm'>
                                    No external login can access this agent's
                                    accounting records.
                                </Text>
                            )}
                            <Group>
                                {membership?.status === 'active' ? (
                                    <Button
                                        color='red'
                                        variant='light'
                                        onClick={() => open({ kind: 'revoke' })}
                                    >
                                        Revoke portal access
                                    </Button>
                                ) : (
                                    <Button
                                        disabled={agent.status !== 'active'}
                                        onClick={() => open({ kind: 'link' })}
                                    >
                                        {membership
                                            ? 'Reactivate portal access'
                                            : 'Link registered agent'}
                                    </Button>
                                )}
                            </Group>
                            {agent.status === 'archived' && (
                                <Alert color='orange'>
                                    Archived agents cannot use the portal.
                                    Reactivating the accounting agent does not
                                    undo a separate access revocation.
                                </Alert>
                            )}
                        </Stack>
                    </Card>
                    <Card withBorder>
                        <Stack gap='sm'>
                            <Group>
                                <Text fw={600}>Current payout destination</Text>
                                {profile && (
                                    <Badge
                                        color={
                                            profile.verifiedAt
                                                ? 'green'
                                                : 'orange'
                                        }
                                    >
                                        {profile.verifiedAt
                                            ? 'Verified'
                                            : 'Pending verification'}
                                    </Badge>
                                )}
                            </Group>
                            {profile ? (
                                <>
                                    <Text size='sm'>
                                        Method:{' '}
                                        {profile.method === 'mpesa'
                                            ? 'M-Pesa'
                                            : 'Bank'}
                                    </Text>
                                    <Text style={{ overflowWrap: 'anywhere' }}>
                                        Account holder: {profile.accountName}
                                    </Text>
                                    <Text style={{ overflowWrap: 'anywhere' }}>
                                        Destination: {profile.destination}
                                    </Text>
                                    <Text size='xs'>
                                        Version: <Code>{profile.id}</Code>
                                    </Text>
                                    <Text size='xs' c='dimmed'>
                                        Submitted{' '}
                                        {formatDateTime(profile.createdAt)}
                                    </Text>
                                    {profile.verifiedAt ? (
                                        <>
                                            <Text size='sm'>
                                                Verified{' '}
                                                {formatDateTime(
                                                    profile.verifiedAt,
                                                )}{' '}
                                                by {profile.verifiedBy}
                                            </Text>
                                            <Text
                                                size='sm'
                                                style={{
                                                    whiteSpace: 'pre-wrap',
                                                    overflowWrap: 'anywhere',
                                                }}
                                            >
                                                Verification evidence:{' '}
                                                {profile.verificationEvidence}
                                            </Text>
                                        </>
                                    ) : (
                                        <Button
                                            w='max-content'
                                            disabled={
                                                membership?.status !==
                                                    'active' ||
                                                agent.status !== 'active'
                                            }
                                            onClick={() =>
                                                open({
                                                    kind: 'verify',
                                                    profile,
                                                })
                                            }
                                        >
                                            Verify payout destination
                                        </Button>
                                    )}
                                </>
                            ) : (
                                <Text size='sm'>
                                    No payout destination submitted. The linked
                                    agent must submit one in the portal before
                                    it can be verified.
                                </Text>
                            )}
                            <Text size='sm' c='dimmed'>
                                Verification applies only to this exact version.
                                A replacement requires fresh verification.
                                Withdrawals and external payouts remain separate
                                manual decisions; this control never transfers
                                funds.
                            </Text>
                        </Stack>
                    </Card>
                </>
            ) : null}
            <Modal
                opened={!!action}
                onClose={() => !busy && setAction(null)}
                title={title}
                closeOnClickOutside={!busy}
                closeOnEscape={!busy}
            >
                <form onSubmit={submit}>
                    <Stack>
                        {actionError && (
                            <Alert color='red' role='alert'>
                                {actionError}
                            </Alert>
                        )}
                        {action?.kind === 'link' ? (
                            <>
                                <Alert color='orange'>
                                    This grants access to this agent's
                                    statements and withdrawal requests. The
                                    identity must already be registered and
                                    email-verified. The link cannot be
                                    transferred to a different login later.
                                </Alert>
                                <TextInput
                                    pb='xs'
                                    label='Verified registered email'
                                    description='Confirm the email directly with the intended agent before granting access.'
                                    descriptionProps={{ mb: 'xs' }}
                                    type='email'
                                    required
                                    maxLength={254}
                                    value={email}
                                    disabled={busy || !!membership}
                                    onChange={(event) =>
                                        setEmail(event.currentTarget.value)
                                    }
                                />
                            </>
                        ) : action?.kind === 'revoke' ? (
                            <Text>
                                Revoke {membership?.email}'s portal reads and
                                actions for this agent. Earnings, balances,
                                agreements, reservations and audit records
                                remain intact. Admin withdrawal processing
                                remains available.
                            </Text>
                        ) : action?.kind === 'verify' ? (
                            <>
                                <Alert color='orange'>
                                    Independently check the account holder and
                                    complete destination. A stale version will
                                    be rejected by the server. No payment is
                                    initiated.
                                </Alert>
                                <Text>
                                    Account holder: {action.profile.accountName}
                                </Text>
                                <Text style={{ overflowWrap: 'anywhere' }}>
                                    Destination: {action.profile.destination}
                                </Text>
                                <Text size='sm'>
                                    Method:{' '}
                                    {action.profile.method === 'mpesa'
                                        ? 'M-Pesa'
                                        : 'Bank'}
                                </Text>
                                <Text size='xs'>
                                    Version: <Code>{action.profile.id}</Code>
                                </Text>
                                <Textarea
                                    pb='xs'
                                    label='Destination verification evidence'
                                    description='Record the independent verification method and supporting reference. Do not enter passwords or OTPs.'
                                    descriptionProps={{ mb: 'xs' }}
                                    required
                                    maxLength={2000}
                                    minRows={3}
                                    value={evidence}
                                    disabled={busy}
                                    onChange={(event) =>
                                        setEvidence(event.currentTarget.value)
                                    }
                                />
                            </>
                        ) : null}
                        <Checkbox
                            pb='xs'
                            label={
                                action?.kind === 'verify'
                                    ? 'I independently verified this exact payout destination.'
                                    : action?.kind === 'revoke'
                                      ? 'I confirm revoking this identity access without deleting financial records.'
                                      : 'I confirmed this registered identity belongs to the intended agent.'
                            }
                            checked={confirmed}
                            disabled={busy}
                            onChange={(event) =>
                                setConfirmed(event.currentTarget.checked)
                            }
                        />
                        <Group justify='flex-end'>
                            <Button
                                variant='default'
                                disabled={busy}
                                onClick={() => setAction(null)}
                            >
                                Cancel
                            </Button>
                            <Button
                                type='submit'
                                color={
                                    action?.kind === 'revoke'
                                        ? 'red'
                                        : undefined
                                }
                                loading={busy}
                                disabled={!confirmed}
                            >
                                {title}
                            </Button>
                        </Group>
                    </Stack>
                </form>
            </Modal>
        </Stack>
    );
}
