import {
    Alert,
    Button,
    Checkbox,
    Group,
    Modal,
    Select,
    Stack,
    TextInput,
} from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { useEffect, useState } from 'react';
import {
    createAgreement,
    listAgentScopes,
    type AgentScope,
} from '@/lib/accountingApi';
import { decimalUnits } from '@/lib/accountingMoney';
import { fuseOptionsFilter } from '@/lib/fuseOptionsFilter';

export function AgreementForm({
    agentId,
    onClose,
    onSaved,
}: {
    agentId: string;
    onClose: () => void;
    onSaved: () => void;
}) {
    const [scopeType, setScopeType] = useState<AgentScope['scopeType']>('nas');
    const [scopes, setScopes] = useState<AgentScope[]>([]);
    const [scopeId, setScopeId] = useState<string | null>(null);
    const [rate, setRate] = useState('');
    const [scheduled, setScheduled] = useState(false);
    const [date, setDate] = useState<string | null>(null);
    const [confirmed, setConfirmed] = useState(false);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [revision, setRevision] = useState(0);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setLoadError('');
        setScopes([]);
        setScopeId(null);
        void (async () => {
            const all: AgentScope[] = [];
            for (let page = 1; ; page++) {
                const result = await listAgentScopes(scopeType, page);
                if (cancelled) return;
                if (!result.success || !result.data) {
                    setLoadError(
                        result.success
                            ? 'Could not load assignment scopes.'
                            : result.message,
                    );
                    setLoading(false);
                    return;
                }
                all.push(...result.data.items);
                if (
                    all.length >= result.data.total ||
                    result.data.items.length === 0
                )
                    break;
            }
            setScopes(all);
            setLoading(false);
        })();
        return () => {
            cancelled = true;
        };
    }, [scopeType, revision]);
    async function submit(event: React.FormEvent) {
        event.preventDefault();
        if (busy) return;
        const bps = decimalUnits(rate);
        if (!scopeId || !scopes.some((scope) => scope.id === scopeId)) {
            setError('Select an owned NAS or service account.');
            return;
        }
        if (bps === null || bps > 10000n) {
            setError(
                'Commission must be between 0 and 100%, with at most 2 decimal places.',
            );
            return;
        }
        const effective = date ? new Date(date.replace(' ', 'T')) : null;
        if (
            scheduled &&
            (!effective ||
                !Number.isFinite(effective.getTime()) ||
                effective.getTime() <= Date.now())
        ) {
            setError('Choose a future effective date and time.');
            return;
        }
        if (!confirmed) {
            setError('Confirm the prospective scope assignment before saving.');
            return;
        }
        setError('');
        setBusy(true);
        const result = await createAgreement(agentId, {
            scopeType,
            scopeId,
            rateBps: Number(bps),
            basis: 'confirmed_collection_gross',
            ...(scheduled ? { effectiveFrom: effective!.toISOString() } : {}),
        });
        setBusy(false);
        if (!result.success) {
            setError(result.message);
            return;
        }
        onSaved();
    }
    return (
        <Modal
            opened
            onClose={() => !busy && onClose()}
            title='Add commission agreement'
            size='lg'
            closeOnClickOutside={!busy}
            closeOnEscape={!busy}
        >
            <form onSubmit={submit}>
                <Stack>
                    <Alert color='orange'>
                        This adds a new effective version, never rewrites past
                        earnings, and supersedes any prior agent for this scope
                        from its start time. A service-account agreement takes
                        precedence over its NAS agreement. Use 0% to stop future
                        commission for a scope.
                    </Alert>
                    {error && (
                        <Alert color='red' role='alert'>
                            {error}
                        </Alert>
                    )}
                    {loadError && (
                        <Alert color='red' role='alert'>
                            {loadError}
                            <Button
                                variant='subtle'
                                onClick={() =>
                                    setRevision((value) => value + 1)
                                }
                            >
                                Retry scopes
                            </Button>
                        </Alert>
                    )}
                    <Select
                        pb='xs'
                        label='Assignment type'
                        data={[
                            { value: 'nas', label: 'NAS device' },
                            {
                                value: 'service_account',
                                label: 'Service account (PPPoE)',
                            },
                        ]}
                        value={scopeType}
                        onChange={(value) => {
                            if (value)
                                setScopeType(value as AgentScope['scopeType']);
                        }}
                        disabled={busy}
                    />
                    <Select
                        pb='xs'
                        label='Assigned scope'
                        required
                        searchable
                        filter={fuseOptionsFilter}
                        data={scopes.map((scope) => ({
                            value: scope.id,
                            label: scope.label,
                        }))}
                        value={scopeId}
                        onChange={setScopeId}
                        loading={loading}
                        disabled={busy || loading || !!loadError}
                        nothingFoundMessage='No owned scopes match.'
                    />
                    <TextInput
                        pb='xs'
                        label='Commission percentage'
                        required
                        inputMode='decimal'
                        description='Percentage of gross confirmed collections, 0 to 100. Up to 2 decimal places.'
                        descriptionProps={{ mb: 'xs' }}
                        value={rate}
                        onChange={(event) => setRate(event.currentTarget.value)}
                        maxLength={6}
                        disabled={busy}
                    />
                    <Checkbox
                        pb='xs'
                        label='Schedule a future start'
                        checked={scheduled}
                        onChange={(event) =>
                            setScheduled(event.currentTarget.checked)
                        }
                        disabled={busy}
                    />
                    {scheduled && (
                        <DateTimePicker
                            pb='xs'
                            highlightToday
                            label='Effective from'
                            description='Uses this browser’s local timezone; stored as an exact UTC instant.'
                            descriptionProps={{ mb: 'xs' }}
                            value={date}
                            onChange={setDate}
                            minDate={new Date()}
                            disabled={busy}
                            popoverProps={{ withinPortal: false }}
                        />
                    )}
                    <Checkbox
                        pb='xs'
                        label='I confirm the scope, percentage, and prospective start.'
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
                            loading={busy}
                            disabled={loading || !!loadError}
                        >
                            Add agreement
                        </Button>
                    </Group>
                </Stack>
            </form>
        </Modal>
    );
}
