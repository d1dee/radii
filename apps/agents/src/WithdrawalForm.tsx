import {
    Alert,
    Anchor,
    Button,
    Checkbox,
    Group,
    Modal,
    PasswordInput,
    Select,
    Stack,
    Text,
    Textarea,
    TextInput,
} from '@mantine/core';
import { useEffect, useState } from 'react';
import { request, type Balance, PortalError } from './api';
import { amountError, money } from './money';
import {
    acknowledgeReceipt,
    createIntent,
    matchesDraft,
    readIntent,
    submitIntent,
    type WithdrawalIntent,
    type WithdrawalReceipt,
} from './withdrawalIntent';

export function WithdrawalForm({
    agentId,
    balances,
    canRequest,
    onClose,
    onSaved,
}: {
    agentId: string;
    balances: Balance[];
    canRequest: boolean;
    onClose: () => void;
    onSaved: () => void;
}) {
    const [intent, setIntent] = useState<WithdrawalIntent | null>(null);
    const [previousIntentId, setPreviousIntentId] = useState<string | null>(null);
    const [loaded, setLoaded] = useState(false);
    const [revision, setRevision] = useState(0);
    const [currency, setCurrency] = useState<string | null>(
        balances[0]?.currency || null,
    );
    const [amount, setAmount] = useState('');
    const [note, setNote] = useState('');
    const [password, setPassword] = useState('');
    const [confirmed, setConfirmed] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [needsLogin, setNeedsLogin] = useState(false);
    const balance = balances.find((item) => item.currency === currency);
    function restore(pending: WithdrawalIntent) {
        setIntent(pending);
        setCurrency(pending.currency);
        setAmount(pending.amount);
        setNote(pending.note || '');
        setConfirmed(false);
        setPassword('');
    }
    useEffect(() => {
        const controller = new AbortController();
        setLoaded(false);
        setError('');
        setNeedsLogin(false);
        void readIntent(agentId, controller.signal)
            .then(({ intent: pending, previousIntentId }) => {
                if (controller.signal.aborted) return;
                if (pending) restore(pending);
                else setIntent(null);
                setPreviousIntentId(previousIntentId);
                setConfirmed(false);
                setPassword('');
                setLoaded(true);
            })
            .catch((err) => {
                if (controller.signal.aborted) return;
                setError(err instanceof Error ? err.message : 'Cannot recover the saved intent.');
                setNeedsLogin(err instanceof PortalError && err.status === 401);
            });
        return () => controller.abort();
    }, [agentId, revision]);
    async function checkSaved() {
        if (!intent || busy || !loaded) return;
        setBusy(true);
        setError('');
        setNeedsLogin(false);
        try {
            const receipt = await request<WithdrawalReceipt>(
                `/${agentId}/withdrawals/by-key/${intent.id}`,
            );
            await acknowledgeReceipt(agentId, intent, receipt);
            onSaved();
        } catch (err) {
            setError(
                err instanceof PortalError && err.status === 404
                    ? 'No matching withdrawal is visible yet. The original submission may still be processing. Its identity stays saved; retry the same request rather than starting another one.'
                    : `${err instanceof Error ? err.message : 'Cannot check the saved request.'} The original identity remains saved.`,
            );
            if (err instanceof PortalError && err.status === 401)
                setNeedsLogin(true);
        } finally {
            setBusy(false);
        }
    }
    async function cancel() {
        if (!intent || intent.withdrawalId || busy || !loaded) return;
        setBusy(true);
        setError('');
        setNeedsLogin(false);
        try {
            await request(`/${agentId}/withdrawal-intent/${intent.id}/cancel`, {});
            setIntent(null);
            setAmount('');
            setNote('');
        } catch (err) {
            setError(`${err instanceof Error ? err.message : 'Cannot cancel intent.'} Reopen this form to recover its current server state.`);
            setNeedsLogin(err instanceof PortalError && err.status === 401);
        } finally {
            setPassword('');
            setConfirmed(false);
            setBusy(false);
            // Cancellation may race a reservation in another tab. Always recover before editing.
            setLoaded(false);
        }
    }
    async function submit(event: React.FormEvent) {
        event.preventDefault();
        if (busy || !loaded) return;
        setError('');
        setNeedsLogin(false);
        const validation = amountError(
            amount.trim(),
            intent ? undefined : balance?.available,
        );
        if (
            validation ||
            !currency ||
            (!intent && !balance) ||
            !confirmed ||
            !password ||
            (!intent && !canRequest)
        ) {
            setError(
                validation ||
                    (!canRequest && !intent
                        ? 'A verified payout profile is required before requesting a withdrawal.'
                        : 'Choose a balance, enter your password and confirm this request.'),
            );
            return;
        }
        let pending = intent;
        setBusy(true);
        try {
            if (!pending) {
                const draft = { amount: amount.trim(), currency, note: note.trim() };
                const result = await createIntent(agentId, draft, previousIntentId);
                pending = result.intent;
                setIntent(pending);
                setPreviousIntentId(result.previousIntentId);
                if (!matchesDraft(pending, draft)) {
                    restore(pending);
                    setError(
                        'An existing server intent has different details. It has been restored without submitting a withdrawal. Review its amount, currency and note, then confirm again or cancel the unreserved intent.',
                    );
                    return;
                }
            }
            await submitIntent(agentId, pending, password);
            onSaved();
        } catch (err) {
            // A failed response never proves that creation or reservation did not commit.
            if (!pending) {
                setLoaded(false);
                setConfirmed(false);
            }
            const detail = err instanceof Error ? err.message : 'Withdrawal result is unknown.';
            setError(
                `${detail} Recover the server intent or retry the same saved request, not a new withdrawal.`,
            );
            if (err instanceof PortalError && err.status === 401) {
                setNeedsLogin(true);
            }
        } finally {
            setBusy(false);
            setPassword('');
        }
    }
    return (
        <Modal
            opened
            onClose={() => !busy && onClose()}
            closeOnClickOutside={!busy}
            closeOnEscape={!busy}
            title='Request manual withdrawal'
            size='lg'
        >
            <form onSubmit={submit}>
                <Stack>
                    <Alert color='blue'>
                        This reserves commission for review by your operator. It
                        does not send money. Approval and external payment are
                        separate steps.
                    </Alert>
                    {!loaded && (
                        <Stack gap='xs'>
                            <Text role='status'>Server recovery is required before submitting a withdrawal.</Text>
                            <Button variant='default' disabled={busy} onClick={() => setRevision((value) => value + 1)}>
                                Check server intent
                            </Button>
                        </Stack>
                    )}
                    {intent && (
                        <Alert color='orange' role='status'>
                            A withdrawal intent is saved on the server. Review
                            the locked amount, currency and note below. Retrying
                            uses the same identity even after signing in again.
                            {intent.withdrawalId && ' A withdrawal is already linked; recover its result rather than starting another request.'}
                            <Text
                                size='xs'
                                mt='xs'
                                style={{ overflowWrap: 'anywhere' }}
                            >
                                Request: {intent.id}
                            </Text>
                        </Alert>
                    )}
                    {intent && (
                        <Button
                            variant='default'
                            disabled={busy || !loaded}
                            onClick={() => void checkSaved()}
                        >
                            Check saved result
                        </Button>
                    )}
                    {intent && !intent.withdrawalId && (
                        <Button variant='subtle' color='red' disabled={busy || !loaded} onClick={() => void cancel()}>
                            Cancel unreserved intent
                        </Button>
                    )}
                    {error && (
                        <Alert color='red' role='alert'>
                            {error}
                            {needsLogin && (
                                <Anchor href='/login' display='block' mt='xs'>
                                    Sign in again
                                </Anchor>
                            )}
                        </Alert>
                    )}
                    <Select
                        pb='xs'
                        label='Currency'
                        data={[...new Set([...balances.map((item) => item.currency), ...(intent ? [intent.currency] : [])])]}
                        value={currency}
                        onChange={setCurrency}
                        allowDeselect={false}
                        disabled={busy || !loaded || !!intent}
                        required
                    />
                    <TextInput
                        pb='xs'
                        label='Amount'
                        description={
                            balance
                                ? `Available: ${money(balance.available, balance.currency)}. Use up to two decimal places.`
                                : 'Choose a currency with an available balance.'
                        }
                        inputMode='decimal'
                        maxLength={21}
                        value={amount}
                        onChange={(event) =>
                            setAmount(event.currentTarget.value)
                        }
                        disabled={busy || !loaded || !!intent}
                        required
                    />
                    <Textarea
                        pb='xs'
                        label='Note (optional)'
                        maxLength={2000}
                        value={note}
                        onChange={(event) => setNote(event.currentTarget.value)}
                        disabled={busy || !loaded || !!intent}
                    />
                    <PasswordInput
                        pb='xs'
                        label='Confirm your password'
                        description='Your password is checked for this request only and is never saved in this browser.'
                        autoComplete='current-password'
                        required
                        maxLength={128}
                        value={password}
                        onChange={(event) =>
                            setPassword(event.currentTarget.value)
                        }
                        disabled={busy || !loaded}
                    />
                    <Checkbox
                        pb='xs'
                        label='I understand this is a manually processed request, not an instant transfer.'
                        checked={confirmed}
                        onChange={(event) =>
                            setConfirmed(event.currentTarget.checked)
                        }
                        disabled={busy || !loaded}
                    />
                    <Group justify='flex-end'>
                        <Button
                            variant='default'
                            disabled={busy}
                            onClick={onClose}
                        >
                            Close
                        </Button>
                        <Button
                            type='submit'
                            loading={busy}
                            disabled={
                                !loaded ||
                                (!canRequest && !intent)
                            }
                        >
                            {intent
                                ? 'Retry saved request'
                                : 'Request withdrawal'}
                        </Button>
                    </Group>
                </Stack>
            </form>
        </Modal>
    );
}
