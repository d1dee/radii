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
import { useState } from 'react';
import { ApiErrorType } from '@shared/index';
import {
    createWithdrawal,
    decideWithdrawal,
    type AgentBalance,
    type AgentWithdrawal,
} from '@/lib/accountingApi';
import { accountingMoney, positiveAmountError } from '@/lib/accountingMoney';

type PendingWithdrawal = {
    key: string;
    currency: string;
    amount: string;
    note: string;
};
// Agent UUIDs are globally unique and tenant-owned. Retain the same intent even
// when browser storage is unavailable or auth temporarily fails during retry.
const pendingRequests = new Map<string, PendingWithdrawal>();
export function pendingWithdrawal(agentId: string): PendingWithdrawal | null {
    const retained = pendingRequests.get(agentId);
    if (retained) return retained;
    try {
        const value = JSON.parse(
            sessionStorage.getItem(`radii:withdrawal:v1:${agentId}`) ?? 'null',
        );
        return value &&
            typeof value.key === 'string' &&
            typeof value.currency === 'string' &&
            typeof value.amount === 'string' &&
            typeof value.note === 'string'
            ? value
            : null;
    } catch {
        return null;
    }
}

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
    const [pending] = useState(() =>
        action === 'request' ? pendingWithdrawal(agentId) : null,
    );
    const [currency, setCurrency] = useState<string | null>(
        pending?.currency ??
            withdrawal?.currency ??
            balances[0]?.currency ??
            null,
    );
    const [amount, setAmount] = useState(pending?.amount ?? '');
    const [note, setNote] = useState(pending?.note ?? '');
    const [reference, setReference] = useState('');
    const [evidence, setEvidence] = useState('');
    const [confirmed, setConfirmed] = useState(false);
    const [key] = useState(() => pending?.key ?? crypto.randomUUID());
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [submitted, setSubmitted] = useState(!!pending);
    const [uncertain, setUncertain] = useState(!!pending);
    const title = {
        request: 'Request manual withdrawal',
        approve: 'Approve withdrawal',
        reject: 'Reject withdrawal',
        paid: 'Record external payout',
    }[action];
    const balance = balances.find((item) => item.currency === currency);
    async function submit(event: React.FormEvent) {
        event.preventDefault();
        if (busy) return;
        let validation: string | null = null;
        if (action === 'request')
            validation = submitted
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
        if (action === 'request') {
            const intent = {
                key,
                currency: currency!,
                amount: amount.trim(),
                note: note.trim(),
            };
            // A reservation must be recoverable even if its response is lost.
            // Fail before POST when the browser cannot retain the request.
            try {
                const storageKey = `radii:withdrawal:v1:${agentId}`;
                const serialized = JSON.stringify(intent);
                sessionStorage.setItem(storageKey, serialized);
                if (sessionStorage.getItem(storageKey) !== serialized)
                    throw new Error('Storage did not retain request');
            } catch {
                setError(
                    'Withdrawal not submitted. Enable session storage for this admin site, then retry. Radii must preserve the request identity before reserving funds.',
                );
                return;
            }
            pendingRequests.set(agentId, intent);
        }
        setBusy(true);
        setError('');
        setSubmitted(true);
        const result =
            action === 'request'
                ? await createWithdrawal(agentId, {
                      amount: amount.trim(),
                      currency: currency!,
                      idempotencyKey: key,
                      note: note.trim() || undefined,
                  })
                : await decideWithdrawal(
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
        setBusy(false);
        if (!result.success || !result.data) {
            const unknown =
                result.success ||
                result.type === ApiErrorType.NETWORK_ERROR ||
                result.type === ApiErrorType.INTERNAL_ERROR;
            if (unknown) setUncertain(true);
            if (!uncertain && !unknown) {
                setSubmitted(false);
                if (action === 'request') {
                    pendingRequests.delete(agentId);
                    try {
                        sessionStorage.removeItem(
                            `radii:withdrawal:v1:${agentId}`,
                        );
                    } catch {
                        /* Storage may be disabled. */
                    }
                }
            }
            setError(
                `${result.success ? 'The server returned no withdrawal result.' : result.message} Refresh the account before starting a separate request. Retrying here keeps the same request identity.`,
            );
            return;
        }
        if (action === 'request') {
            pendingRequests.delete(agentId);
            try {
                sessionStorage.removeItem(`radii:withdrawal:v1:${agentId}`);
            } catch {
                /* Storage may be disabled. */
            }
        }
        onSaved();
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
                    {pending && (
                        <Alert color='orange'>
                            An earlier submission has an uncertain result. Retry
                            this same request to recover its result without
                            reserving twice. Its amount and request identity are
                            preserved.
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
                                data={balances.map((item) => item.currency)}
                                value={currency}
                                onChange={setCurrency}
                                disabled={busy || submitted}
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
                                disabled={busy || submitted}
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
                                busy || (action === 'request' && submitted)
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
                        disabled={busy}
                    />
                    <Group justify='flex-end'>
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
                        >
                            {title}
                        </Button>
                    </Group>
                </Stack>
            </form>
        </Modal>
    );
}
