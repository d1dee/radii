import classes from '@/components/Accounting/Accounting.module.css';
import {
    AccountingRow,
    AccountingTable,
} from '@/components/Accounting/AccountingTable';
import { AgentAccountingDetail } from '@/components/Accounting/AgentAccountingDetail';
import { AgentForm } from '@/components/Accounting/AgentForm';
import { PageLayout } from '@/components/Layout/PageLayout';
import { listAgents, type AgentSummary } from '@/lib/accountingApi';
import { accountingMoney } from '@/lib/accountingMoney';
import { formatDateTime } from '@/lib/format';
import { tableRowNumber, useTablePageSize } from '@/lib/pagination';
import { useAdminSettings } from '@/lib/settings';
import {
    Alert,
    Badge,
    Button,
    Center,
    Group,
    Loader,
    Select,
    Stack,
    Table,
    Text,
    TextInput,
    Title,
} from '@mantine/core';
import Fuse from 'fuse.js';
import { useDeferredValue, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

export default function AgentAccountingPage() {
    return <AgentDirectory />;
}

function AgentDirectory() {
    const { agentId } = useParams();
    const navigate = useNavigate();
    const [agents, setAgents] = useState<AgentSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [revision, setRevision] = useState(0);
    const [creating, setCreating] = useState(false);
    const [search, setSearch] = useState('');
    const query = useDeferredValue(search.trim());
    const [status, setStatus] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const { settings, loaded } = useAdminSettings();
    const [pageSize, setPageSize] = useTablePageSize(
        settings.dashboard.perPage,
        loaded,
    );
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError('');
        void (async () => {
            const all: AgentSummary[] = [];
            for (let next = 1; ; next++) {
                const response = await listAgents(next);
                if (cancelled) return;
                if (!response.success || !response.data) {
                    setError(
                        response.success
                            ? 'Could not load agents.'
                            : response.message,
                    );
                    setLoading(false);
                    return;
                }
                all.push(...response.data.items);
                if (
                    all.length >= response.data.total ||
                    response.data.items.length === 0
                )
                    break;
            }
            setAgents(all);
            setLoading(false);
        })();
        return () => {
            cancelled = true;
        };
    }, [revision]);
    const matches = query
        ? new Fuse(agents, {
              keys: ['name', 'phone', 'notes'],
              threshold: 0.3,
              ignoreLocation: true,
          })
              .search(query)
              .map(({ item }) => item)
        : agents;
    const filtered = matches.filter(
        (agent) => !status || agent.status === status,
    );
    const currentPage = Math.min(
        page,
        pageSize === 'all'
            ? 1
            : Math.max(1, Math.ceil(filtered.length / pageSize)),
    );
    return (
        <PageLayout
            label='Agent accounting content'
            header={
                <Group justify='space-between' align='flex-start'>
                    <Stack gap={4}>
                        <Group>
                            <Title order={3}>Agent accounting</Title>{' '}
                            {!loading && !error && (
                                <Group gap='xs'>
                                    <Badge color='green' variant='light'>
                                        {
                                            agents.filter(
                                                (agent) =>
                                                    agent.status === 'active',
                                            ).length
                                        }{' '}
                                        active
                                    </Badge>
                                    <Badge color='orange' variant='light'>
                                        {
                                            agents.filter(
                                                (agent) =>
                                                    agent.status === 'archived',
                                            ).length
                                        }{' '}
                                        archived
                                    </Badge>
                                </Group>
                            )}
                        </Group>

                        <Text c='dimmed' size='sm'>
                            Manage agents, commission agreements and manual
                            withdrawals.
                        </Text>
                    </Stack>
                    <Button onClick={() => setCreating(true)}>
                        Create agent
                    </Button>
                </Group>
            }
        >
            <Group align='flex-start'>
                <TextInput
                    pb='xs'
                    aria-label='Search agents'
                    placeholder='Search agents by name or phone'
                    value={search}
                    onChange={(event) => {
                        setSearch(event.currentTarget.value);
                        setPage(1);
                    }}
                    style={{ flex: '1 1 240px' }}
                />
                <Select
                    pb='xs'
                    aria-label='Agent status'
                    placeholder='All statuses'
                    clearable
                    data={[
                        { value: 'active', label: 'Active' },
                        { value: 'archived', label: 'Archived' },
                    ]}
                    value={status}
                    onChange={(value) => {
                        setStatus(value);
                        setPage(1);
                    }}
                />
                <Button
                    variant='default'
                    onClick={() => setRevision((value) => value + 1)}
                    disabled={loading}
                >
                    Refresh
                </Button>
            </Group>
            {loading ? (
                <Center py='xl'>
                    <Loader aria-label='Loading agents' />
                </Center>
            ) : error ? (
                <Alert color='red' role='alert'>
                    {error}
                    <Button
                        variant='subtle'
                        onClick={() => setRevision((value) => value + 1)}
                    >
                        Retry
                    </Button>
                </Alert>
            ) : (
                <AccountingTable
                    headers={[
                        '#',
                        'Agent',
                        'Contact',
                        'Status',
                        'Current agreements',
                        'Financial summary',
                        'Created',
                    ]}
                    total={filtered.length}
                    pageSize={pageSize}
                    onPageSize={(value) => {
                        setPageSize(value);
                        setPage(1);
                    }}
                    page={currentPage}
                    onPage={setPage}
                    empty='No agents match. Create an agent to begin.'
                    label='Agents table'
                >
                    {filtered
                        .slice(
                            pageSize === 'all'
                                ? 0
                                : (currentPage - 1) * pageSize,
                            pageSize === 'all'
                                ? undefined
                                : currentPage * pageSize,
                        )
                        .map((agent, index) => (
                            <AccountingRow
                                key={agent.id}
                                label={`Open ${agent.name}`}
                                selected={agent.id === agentId}
                                onOpen={() =>
                                    navigate(`/agent-accounting/${agent.id}`)
                                }
                            >
                                <Table.Td>
                                    {tableRowNumber(
                                        currentPage,
                                        pageSize,
                                        index,
                                    )}
                                </Table.Td>
                                <Table.Td>
                                    <Link
                                        className={classes.identity}
                                        to={`/agent-accounting/${agent.id}`}
                                    >
                                        {agent.name}
                                    </Link>
                                    {agent.notes && (
                                        <Text
                                            c='dimmed'
                                            size='xs'
                                            maw={320}
                                            lineClamp={2}
                                            style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}
                                        >
                                            {agent.notes}
                                        </Text>
                                    )}
                                </Table.Td>
                                <Table.Td>
                                    {agent.phone || 'Not provided'}
                                    {agent.email && (
                                        <Text c='dimmed' size='xs'>
                                            {agent.email}
                                        </Text>
                                    )}
                                </Table.Td>
                                <Table.Td>
                                    <Badge
                                        color={
                                            agent.status === 'active'
                                                ? 'green'
                                                : 'orange'
                                        }
                                    >
                                        {agent.status === 'active'
                                            ? 'Active'
                                            : 'Archived'}
                                    </Badge>
                                </Table.Td>
                                <Table.Td>
                                    <Text size='sm' fw={600}>
                                        {agent.currentAgreementCount}{' '}
                                        {agent.currentAgreementCount === 1
                                            ? 'agreement'
                                            : 'agreements'}
                                    </Text>
                                </Table.Td>
                                <Table.Td>
                                    {agent.balances.length ? (
                                        <Stack gap='xs'>
                                            {agent.balances.map((balance) => (
                                                <div key={balance.currency}>
                                                    <Text size='sm' fw={600}>
                                                        {accountingMoney(
                                                            balance.available,
                                                            balance.currency,
                                                        )}{' '}
                                                        available
                                                    </Text>
                                                    <Text c='dimmed' size='xs'>
                                                        Reserved: {accountingMoney(
                                                            balance.reserved,
                                                            balance.currency,
                                                        )}
                                                    </Text>
                                                    <Text c='dimmed' size='xs'>
                                                        Earned: {accountingMoney(
                                                            balance.earned,
                                                            balance.currency,
                                                        )}
                                                    </Text>
                                                    <Text c='dimmed' size='xs'>
                                                        Paid: {accountingMoney(
                                                            balance.paid,
                                                            balance.currency,
                                                        )}
                                                    </Text>
                                                </div>
                                            ))}
                                        </Stack>
                                    ) : (
                                        <Text size='sm'>No financial activity</Text>
                                    )}
                                </Table.Td>
                                <Table.Td>
                                    {formatDateTime(agent.createdAt)}
                                </Table.Td>
                            </AccountingRow>
                        ))}
                </AccountingTable>
            )}
            {creating && (
                <AgentForm
                    onClose={() => setCreating(false)}
                    onSaved={() => {
                        setCreating(false);
                        setRevision((value) => value + 1);
                    }}
                />
            )}
            {agentId && (
                <AgentAccountingDetail
                    key={agentId}
                    id={agentId}
                    onClose={() => {
                        navigate('/agent-accounting');
                        setRevision((value) => value + 1);
                    }}
                    onAgentUpdated={(updated) =>
                        setAgents((items) =>
                            items.map((agent) =>
                                agent.id === updated.id
                                    ? { ...agent, ...updated }
                                    : agent,
                            ),
                        )
                    }
                />
            )}
        </PageLayout>
    );
}
