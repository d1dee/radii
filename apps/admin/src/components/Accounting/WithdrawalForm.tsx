import {
    Alert,
    Button,
    Checkbox,
    Group,
    Modal,
    Select,
    Stack,
    Text,
    Textarea,
    TextInput,
} from '@mantine/core';
import { useEffect, useState } from 'react';
import {
    acknowledgeWithdrawalIntent,
    cancelWithdrawalIntent,
    createWithdrawal,
    createWithdrawalIntent,
    decideWithdrawal,
    getWithdrawalIntent,
    type AgentBalance,
    type AgentWithdrawal,
    type WithdrawalIntent,
} from '@/lib/accountingApi';
import { accountingMoney, positiveAmountError } from '@/lib/accountingMoney';
import {
    matchesWithdrawalReceipt,
    matchesWithdrawalValues,
} from '@/lib/withdrawalIntent';

export function WithdrawalForm({
    agentId,
    balances,
    withdrawal,
    action,
    onClose,
    onSaved,
}: {
    agentId: string;
    balances: AgentBalance[];
    withdrawal?: AgentWithdrawal;
    action: 'request' | 'approve' | 'reject' | 'paid';
    onClose: () => void;
    onSaved: () => void;
}) {
    const [intent, setIntent] = useState<WithdrawalIntent | null>(null);
    const [previousIntentId, setPreviousIntentId] = useState<string | null>(null);
    const [currency, setCurrency] = useState<string | null>(
        withdrawal?.currency ?? balances[0]?.currency ?? null,
    );
    const [amount, setAmount] = useState('');
    const [note, setNote] = useState('');
    const [reference, setReference] = useState('');
    const [evidence, setEvidence] = useState('');
    const [confirmed, setConfirmed] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [submitted, setSubmitted] = useState(false);
    const [recovering, setRecovering] = useState(action === 'request');
    const [recoveryReady, setRecoveryReady] = useState(action !== 'request');
    const [recoveryRevision, setRecoveryRevision] = useState(0);
    function restoreIntent(value: WithdrawalIntent) {
        setIntent(value);
        setCurrency(value.currency);
        setAmount(value.amount);
        setNote(value.note ?? '');
        setConfirmed(false);
    }
    useEffect(() => {
        if (action !== 'request') return;
        let cancelled = false;
        setRecovering(true);
        setRecoveryReady(false);
        void getWithdrawalIntent(agentId).then((result) => {
            if (cancelled) return;
            setRecovering(false);
            if (!result.success || !result.data) {
                setError(
                    result.success
                        ? 'The server returned no intent result.'
                        : result.message,
                );
                return;
            }
            if (result.data.intent) restoreIntent(result.data.intent);
            else setIntent(null);
            setPreviousIntentId(result.data.previousIntentId);
            setConfirmed(false);
            setError('');
            setRecoveryReady(true);
        });
        return () => {
            cancelled = true;
        };
    }, [agentId, action, recoveryRevision]);
    const title = {
        request: 'Request manual withdrawal',
        approve: 'Approve withdrawal',
        reject: 'Reject withdrawal',
        paid: 'Record external payout',
    }[action];
    const balance = balances.find((item) => item.currency === currency);
    async function submit(event: React.FormEvent) {
        event.preventDefault();
        if (busy || recovering || !recoveryReady) return;
        let validation: string | null = null;
        if (action === 'request')
            validation = intent
                ? positiveAmountError(amount)
                : !balance
                  ? 'Choose a currency with an available balance.'
                  : positiveAmountError(amount, balance.available);
        if (note.trim().length > 2000)
            validation = 'Notes must be 2000 characters or fewer.';
        if (action === 'reject' && !note.trim())
            validation = 'A rejection reason is required.';
        if (action === 'paid' && (!reference.trim() || !evidence.trim()))
            validation =
                'Both an external payment reference and evidence are required.';
        if (!confirmed)
            validation = 'Confirm the financial action before continuing.';
        if (validation) {
            setError(validation);
            return;
        }
        setBusy(true);
        setError('');
        try {
            if (action === 'request') {
                let current = intent;
                if (!current) {
                    const values = {
                        amount: amount.trim(),
                        currency: currency!,
                        note: note.trim() || undefined,
                        previousIntentId,
                    };
                    const prepared = await createWithdrawalIntent(agentId, values);
                    if (!prepared.success || !prepared.data?.intent) {
                        setRecoveryReady(false);
                        setConfirmed(false);
                        setError(`${prepared.success ? 'The server returned no intent result.' : prepared.message} Recover the latest server-backed request and review its details before confirming again.`);
                        return;
                    }
                    current = prepared.data.intent;
                    setIntent(current);
                    if (!matchesWithdrawalValues(current, values)) {
                        restoreIntent(current);
                        setError('An existing request has different details. Review the restored amount, currency, and note, then confirm again. No new reservation was submitted.');
                        return;
                    }
                }
                const result = await createWithdrawal(agentId, {
                    intentId: current.id,
                });
                if (!result.success || !result.data) {
                    setError(`${result.success ? 'The server returned no withdrawal receipt.' : result.message} Retry this same server-backed request to recover its result.`);
                    return;
                }
                if (!matchesWithdrawalReceipt(agentId, current, result.data)) {
                    setError('The receipt does not match this request. The server-backed identity has been retained. Refresh and retry to recover the matching receipt.');
                    return;
                }
                setIntent({ ...current, withdrawalId: result.data.id });
                const acknowledged = await acknowledgeWithdrawalIntent(
                    agentId, current.id,
                );
                if (!acknowledged.success) {
                    setError(`${acknowledged.message} The withdrawal receipt was confirmed, but acknowledgement is incomplete. Retry to safely recover and acknowledge the same request.`);
                    return;
                }
            } else {
                setSubmitted(true);
                const result = await decideWithdrawal(
                    agentId,
                    withdrawal!.id,
                    action,
                    action === 'reject'
                        ? { reason: note.trim() }
                        : action === 'paid'
                          ? {
                                reference: reference.trim(),
                                evidence: evidence.trim(),
                            }
                          : {},
                );
                if (!result.success || !result.data) {
                    setError(`${result.success ? 'The server returned no withdrawal result.' : result.message} Refresh the account before starting a separate action.`);
                    return;
                }
            }
            onSaved();
        } catch {
            if (action === 'request' && !intent) {
                setRecoveryReady(false);
                setConfirmed(false);
            }
            setError('The action could not be confirmed. Reopen this form to recover the server-backed request before starting a separate withdrawal.');
        } finally {
            setBusy(false);
        }
    }
    async function cancelIntent() {
        if (!intent || intent.withdrawalId || busy) return;
        setBusy(true);
        try {
            const result = await cancelWithdrawalIntent(agentId, intent.id);
            if (!result.success) {
                setError(`${result.message} The request is retained; recover it before continuing.`);
                setRecoveryReady(false);
                return;
            }
            setIntent(null);
            setAmount('');
            setNote('');
            setConfirmed(false);
            setError('');
            setRecoveryReady(false);
            setRecoveryRevision((value) => value + 1);
        } catch {
            setError('Cancellation could not be confirmed. Recover the server-backed request before continuing.');
            setRecoveryReady(false);
        } finally {
            setBusy(false);
        }
    }
    return (
        <Modal
            opened
            onClose={() => !busy && onClose()}
            title={title}
            closeOnClickOutside={!busy}
            closeOnEscape={!busy}
        >
            <form onSubmit={submit}>
                <Stack>
                    {error && (
                        <Alert color='red' role='alert'>
                            {error}
                        </Alert>
                    )}
                    {action === 'request' && !recoveryReady && (
                        <Button
                            variant='light'
                            loading={recovering}
                            onClick={() => setRecoveryRevision((value) => value + 1)}
                        >
                            Recover withdrawal request
                        </Button>
                    )}
                    {intent && (
                        <Alert color='orange'>
                            A server-backed request is preserved. Review its
                            details and confirm to recover or submit the same
                            request without reserving twice.
                        </Alert>
                    )}
                    <Alert color={action === 'paid' ? 'orange' : 'blue'}>
                        {action === 'paid'
                            ? 'Record only money already paid outside Radii. This action does not transfer money and cannot be undone here.'
                            : action === 'request'
                              ? 'Reserves earned funds immediately. Approval and external payout are separate steps.'
                              : action === 'reject'
                                ? 'Releases reserved funds back to the available balance. The reason is retained in the audit history.'
                                : 'Approval authorizes manual processing but does not send money. Funds remain reserved until payout or rejection.'}
                    </Alert>
                    {withdrawal && (
                        <Text fw={600}>
                            {accountingMoney(
                                withdrawal.amount,
                                withdrawal.currency,
                            )}{' '}
                            <Text span c='dimmed' size='sm'>
                                ({withdrawal.status})
                            </Text>
                        </Text>
                    )}
                    {action === 'request' && (
                        <>
                            <Select
                                pb='xs'
                                label='Currency'
                                required
                                data={Array.from(new Set([
                                    ...balances.map((item) => item.currency),
                                    ...(intent ? [intent.currency] : []),
                                ]))}
                                value={currency}
                                onChange={setCurrency}
                                disabled={
                                    busy || recovering || !recoveryReady || !!intent
                                }
                            />
                            <TextInput
                                pb='xs'
                                label='Withdrawal amount'
                                required
                                inputMode='decimal'
                                description={
                                    balance
                                        ? `Available: ${accountingMoney(balance.available, balance.currency)}`
                                        : 'No earned balance is available.'
                                }
                                descriptionProps={{ mb: 'xs' }}
                                value={amount}
                                onChange={(event) =>
                                    setAmount(event.currentTarget.value)
                                }
                                disabled={
                                    busy || recovering || !recoveryReady || !!intent
                                }
                                maxLength={21}
                            />
                        </>
                    )}
                    {(action === 'request' || action === 'reject') && (
                        <Textarea
                            pb='xs'
                            label={
                                action === 'reject'
                                    ? 'Rejection reason'
                                    : 'Withdrawal note'
                            }
                            required={action === 'reject'}
                            maxLength={2000}
                            value={note}
                            onChange={(event) =>
                                setNote(event.currentTarget.value)
                            }
                            disabled={
                                busy || (action === 'request' &&
                                    (recovering || !recoveryReady || !!intent))
                            }
                        />
                    )}
                    {action === 'paid' && (
                        <>
                            <TextInput
                                pb='xs'
                                label='External payout reference'
                                required
                                maxLength={200}
                                value={reference}
                                onChange={(event) =>
                                    setReference(event.currentTarget.value)
                                }
                                disabled={busy || submitted}
                            />
                            <Textarea
                                pb='xs'
                                label='Payout evidence'
                                description='Receipt identifier, document location, or clear supporting details. Do not enter credentials.'
                                descriptionProps={{ mb: 'xs' }}
                                required
                                maxLength={4000}
                                value={evidence}
                                onChange={(event) =>
                                    setEvidence(event.currentTarget.value)
                                }
                                disabled={busy || submitted}
                            />
                        </>
                    )}
                    <Checkbox
                        pb='xs'
                        label={
                            action === 'paid'
                                ? 'I verified the external payout, amount, recipient, and evidence.'
                                : 'I confirm this withdrawal action and amount.'
                        }
                        checked={confirmed}
                        onChange={(event) =>
                            setConfirmed(event.currentTarget.checked)
                        }
                        disabled={busy || recovering || !recoveryReady}
                    />
                    <Group justify='flex-end'>
                        {intent && !intent.withdrawalId && (
                            <Button
                                variant='light'
                                color='red'
                                onClick={cancelIntent}
                                disabled={busy || recovering || !recoveryReady}
                            >
                                Discard unreserved request
                            </Button>
                        )}
                        <Button
                            variant='default'
                            onClick={onClose}
                            disabled={busy}
                        >
                            Cancel
                        </Button>
                        <Button
                            type='submit'
                            color={action === 'reject' ? 'red' : undefined}
                            loading={busy}
                            disabled={recovering || !recoveryReady}
                        >
                            {title}
                        </Button>
                    </Group>
                </Stack>
            </form>
        </Modal>
    );
}
