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
    SimpleGrid,
    Stack,
    Table,
    Tabs,
    Text,
    Title,
} from '@mantine/core';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AccountingTable } from './AccountingTable';
import { AgentForm } from './AgentForm';
import { AgreementForm } from './AgreementForm';
import { WithdrawalAudit } from './WithdrawalAudit';
import { pendingWithdrawal, WithdrawalForm } from './WithdrawalForm';
import { PageLayout } from '@/components/Layout/PageLayout';
import {
    getAgent,
    getAgentStatement,
    listAgreements,
    listWithdrawals,
    updateAgent,
    type AccountingPage,
    type Agent,
    type AgentAgreement,
    type AgentJournal,
    type AgentStatement,
    type AgentWithdrawal,
} from '@/lib/accountingApi';
import { accountingMoney, decimalUnits } from '@/lib/accountingMoney';
import { formatDateTime } from '@/lib/format';
import { tableRowNumber } from '@/lib/pagination';

type Detail = {
    agent: Agent;
    statement: AgentStatement;
    agreements: AccountingPage<AgentAgreement>;
    withdrawals: AccountingPage<AgentWithdrawal>;
};
type FinancialAction = {
    action: 'request' | 'approve' | 'reject' | 'paid';
    withdrawal?: AgentWithdrawal;
};
const journalLabels = {
    accrual: 'Commission earned',
    reserve: 'Withdrawal reserved',
    release: 'Reservation released',
    paid: 'External payout',
};

export function AgentAccountingDetail({ id }: { id: string }) {
    const [data, setData] = useState<Detail | null>(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [revision, setRevision] = useState(0);
    const [agreementPage, setAgreementPage] = useState(1);
    const [statementPage, setStatementPage] = useState(1);
    const [withdrawalPage, setWithdrawalPage] = useState(1);
    const [editing, setEditing] = useState(false);
    const [addingAgreement, setAddingAgreement] = useState(false);
    const [statusModal, setStatusModal] = useState(false);
    const [statusConfirmed, setStatusConfirmed] = useState(false);
    const [statusBusy, setStatusBusy] = useState(false);
    const [statusError, setStatusError] = useState('');
    const [action, setAction] = useState<FinancialAction | null>(() =>
        pendingWithdrawal(id) ? { action: 'request' } : null,
    );
    const [auditId, setAuditId] = useState<string | null>(null);
    const [journal, setJournal] = useState<AgentJournal | null>(null);
    const [notice, setNotice] = useState('');
    const [tab, setTab] = useState<string | null>('statement');
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError('');
        void Promise.all([
            getAgent(id),
            getAgentStatement(id, statementPage),
            listAgreements(id, agreementPage),
            listWithdrawals(id, withdrawalPage),
        ]).then(([agent, statement, agreements, withdrawals]) => {
            if (cancelled) return;
            setLoading(false);
            for (const response of [
                agent,
                statement,
                agreements,
                withdrawals,
            ]) {
                if (!response.success) {
                    setError(response.message);
                    return;
                }
            }
            if (
                !agent.success ||
                !statement.success ||
                !agreements.success ||
                !withdrawals.success ||
                !agent.data ||
                !statement.data ||
                !agreements.data ||
                !withdrawals.data
            ) {
                setError('The server returned incomplete accounting data.');
                return;
            }
            setData({
                agent: agent.data,
                statement: statement.data,
                agreements: agreements.data,
                withdrawals: withdrawals.data,
            });
        });
        return () => {
            cancelled = true;
        };
    }, [id, revision, statementPage, agreementPage, withdrawalPage]);
    const refresh = (message = '') => {
        setNotice(message);
        setRevision((value) => value + 1);
    };
    async function changeStatus() {
        if (!data || statusBusy || !statusConfirmed) return;
        setStatusBusy(true);
        setStatusError('');
        const result = await updateAgent(id, {
            status: data.agent.status === 'active' ? 'archived' : 'active',
        });
        setStatusBusy(false);
        if (!result.success) {
            setStatusError(result.message);
            return;
        }
        setStatusModal(false);
        refresh('Agent status updated.');
    }
    const active = data?.agent.status === 'active';
    const canWithdraw =
        !!pendingWithdrawal(id) ||
        (active &&
            data?.statement.balances.some(
                (balance) => (decimalUnits(balance.available) ?? 0n) > 0n,
            ));
    return (
        <PageLayout
            label='Agent accounting detail content'
            header={
                <Stack gap='xs'>
                    <Button
                        component={Link}
                        to='/agent-accounting'
                        variant='subtle'
                        w='max-content'
                        size='compact-sm'
                    >
                        Back to agents
                    </Button>
                    <Group justify='space-between' align='flex-start'>
                        <Stack gap={4}>
                            <Title order={3}>
                                {data?.agent.name ?? 'Agent accounting'}
                            </Title>
                            <Text c='dimmed' size='sm'>
                                {data?.agent.phone ||
                                    'Commission agreements, balances and manual withdrawals.'}
                            </Text>
                        </Stack>
                        <Button
                            variant='default'
                            onClick={() => refresh()}
                            disabled={loading}
                        >
                            Refresh account
                        </Button>
                    </Group>
                </Stack>
            }
        >
            {notice && (
                <Alert
                    color='green'
                    role='status'
                    withCloseButton
                    onClose={() => setNotice('')}
                >
                    {notice}
                </Alert>
            )}
            {loading ? (
                <Center py='xl'>
                    <Loader aria-label='Loading agent accounting' />
                </Center>
            ) : error ? (
                <Alert color='red' role='alert'>
                    {error}
                    <Button variant='subtle' onClick={() => refresh()}>
                        Retry
                    </Button>
                </Alert>
            ) : data ? (
                <>
                    <Group>
                        <Badge color={active ? 'green' : 'orange'}>
                            {active ? 'Active' : 'Archived'}
                        </Badge>
                        <Button
                            size='xs'
                            variant='default'
                            onClick={() => setEditing(true)}
                        >
                            Edit agent
                        </Button>
                        <Button
                            size='xs'
                            variant='light'
                            color={active ? 'orange' : 'green'}
                            onClick={() => {
                                setStatusConfirmed(false);
                                setStatusError('');
                                setStatusModal(true);
                            }}
                        >
                            {active ? 'Archive agent' : 'Reactivate agent'}
                        </Button>
                        <Text size='xs' c='dimmed'>
                            Created {formatDateTime(data.agent.createdAt)}
                        </Text>
                    </Group>
                    {data.agent.notes && (
                        <Text
                            size='sm'
                            style={{
                                whiteSpace: 'pre-wrap',
                                overflowWrap: 'anywhere',
                            }}
                        >
                            {data.agent.notes}
                        </Text>
                    )}
                    {!active && (
                        <Alert color='orange'>
                            Archived agents earn no new commission and cannot
                            request new withdrawals. Historical balances and
                            existing withdrawal decisions remain available.
                        </Alert>
                    )}
                    <Stack gap='sm' aria-label='Agent balances'>
                        {data.statement.balances.length === 0 ? (
                            <Alert color='gray'>
                                No earnings yet. Balances appear after eligible
                                confirmed collections.
                            </Alert>
                        ) : (
                            data.statement.balances.map((balance) => (
                                <Card withBorder key={balance.currency}>
                                    <Text fw={600} mb='sm'>
                                        {balance.currency} balances
                                    </Text>
                                    <SimpleGrid
                                        cols={{ base: 1, xs: 2, lg: 4 }}
                                    >
                                        {(
                                            [
                                                'available',
                                                'reserved',
                                                'paid',
                                                'earned',
                                            ] as const
                                        ).map((kind) => (
                                            <Stack gap={2} key={kind}>
                                                <Text
                                                    size='xs'
                                                    c='dimmed'
                                                    tt='capitalize'
                                                >
                                                    {kind === 'earned'
                                                        ? 'Lifetime earned'
                                                        : kind}
                                                </Text>
                                                <Text
                                                    fw={700}
                                                    style={{
                                                        overflowWrap:
                                                            'anywhere',
                                                    }}
                                                >
                                                    {accountingMoney(
                                                        balance[kind],
                                                        balance.currency,
                                                    )}
                                                </Text>
                                            </Stack>
                                        ))}
                                    </SimpleGrid>
                                </Card>
                            ))
                        )}
                    </Stack>
                    <Text size='xs' c='dimmed'>
                        Balances are derived from the immutable journal,
                        separated by currency. Reserved funds include approved
                        withdrawals. No balance can be edited here.
                    </Text>
                    <Tabs value={tab} onChange={setTab} keepMounted={false}>
                        <Tabs.List>
                            <Tabs.Tab value='statement'>Statement</Tabs.Tab>
                            <Tabs.Tab value='agreements'>Agreements</Tabs.Tab>
                            <Tabs.Tab value='withdrawals'>Withdrawals</Tabs.Tab>
                        </Tabs.List>
                        <Tabs.Panel value='statement' pt='md'>
                            <Stack>
                                <Text size='sm' c='dimmed'>
                                    Each row records equal debit and credit
                                    entries. Open its source snapshot to inspect
                                    collection and agreement attribution.
                                </Text>
                                <AccountingTable
                                    headers={[
                                        '#',
                                        'Recorded',
                                        'Movement',
                                        'Amount',
                                        'Debit',
                                        'Credit',
                                        'Source',
                                    ]}
                                    total={data.statement.total}
                                    page={statementPage}
                                    onPage={setStatementPage}
                                    empty='No journal movements yet.'
                                    label='Statement table'
                                >
                                    {data.statement.items.map(
                                        (entry, index) => (
                                            <Table.Tr key={entry.id}>
                                                <Table.Td>
                                                    {tableRowNumber(
                                                        statementPage,
                                                        10,
                                                        index,
                                                    )}
                                                </Table.Td>
                                                <Table.Td>
                                                    {formatDateTime(
                                                        entry.createdAt,
                                                    )}
                                                </Table.Td>
                                                <Table.Td>
                                                    {journalLabels[entry.kind]}
                                                </Table.Td>
                                                <Table.Td className='admin-table-value'>
                                                    {accountingMoney(
                                                        entry.amount,
                                                        entry.currency,
                                                    )}
                                                </Table.Td>
                                                <Table.Td>
                                                    {entry.debitAccount}
                                                </Table.Td>
                                                <Table.Td>
                                                    {entry.creditAccount}
                                                </Table.Td>
                                                <Table.Td>
                                                    <Button
                                                        variant='subtle'
                                                        size='xs'
                                                        onClick={() =>
                                                            setJournal(entry)
                                                        }
                                                    >
                                                        Source snapshot
                                                    </Button>
                                                </Table.Td>
                                            </Table.Tr>
                                        ),
                                    )}
                                </AccountingTable>
                            </Stack>
                        </Tabs.Panel>
                        <Tabs.Panel value='agreements' pt='md'>
                            <Stack>
                                <Group justify='space-between'>
                                    <Text size='sm' c='dimmed'>
                                        Immutable rate versions. Future versions
                                        supersede the scope, not historical
                                        earnings.
                                    </Text>
                                    <Button
                                        onClick={() => setAddingAgreement(true)}
                                        disabled={!active}
                                    >
                                        Add agreement
                                    </Button>
                                </Group>
                                <AccountingTable
                                    headers={[
                                        '#',
                                        'Scope',
                                        'Scope ID',
                                        'Commission',
                                        'Effective From',
                                        'Recorded',
                                        'Recorded By',
                                    ]}
                                    total={data.agreements.total}
                                    page={agreementPage}
                                    onPage={setAgreementPage}
                                    empty='No agreements. Add a prospective rate for an owned NAS or service account.'
                                    label='Agreements table'
                                >
                                    {data.agreements.items.map(
                                        (agreement, index) => (
                                            <Table.Tr key={agreement.id}>
                                                <Table.Td>
                                                    {tableRowNumber(
                                                        agreementPage,
                                                        10,
                                                        index,
                                                    )}
                                                </Table.Td>
                                                <Table.Td>
                                                    {agreement.scopeType ===
                                                    'nas'
                                                        ? 'NAS device'
                                                        : 'Service account'}
                                                </Table.Td>
                                                <Table.Td>
                                                    <Code>
                                                        {agreement.scopeId}
                                                    </Code>
                                                </Table.Td>
                                                <Table.Td>
                                                    {(
                                                        agreement.rateBps / 100
                                                    ).toFixed(2)}
                                                    %
                                                </Table.Td>
                                                <Table.Td>
                                                    {formatDateTime(
                                                        agreement.effectiveFrom,
                                                    )}
                                                </Table.Td>
                                                <Table.Td>
                                                    {formatDateTime(
                                                        agreement.createdAt,
                                                    )}
                                                </Table.Td>
                                                <Table.Td>
                                                    <Code>
                                                        {agreement.actorAdminId}
                                                    </Code>
                                                </Table.Td>
                                            </Table.Tr>
                                        ),
                                    )}
                                </AccountingTable>
                            </Stack>
                        </Tabs.Panel>
                        <Tabs.Panel value='withdrawals' pt='md'>
                            <Stack>
                                <Group justify='space-between'>
                                    <Text size='sm' c='dimmed'>
                                        Manual reservations, approvals,
                                        rejections and externally paid receipts.
                                        No automatic B2C.
                                    </Text>
                                    <Button
                                        onClick={() =>
                                            setAction({ action: 'request' })
                                        }
                                        disabled={!canWithdraw}
                                    >
                                        Request withdrawal
                                    </Button>
                                </Group>
                                <AccountingTable
                                    headers={[
                                        '#',
                                        'Requested',
                                        'Amount',
                                        'Status',
                                        'Reference',
                                        'Actions',
                                    ]}
                                    total={data.withdrawals.total}
                                    page={withdrawalPage}
                                    onPage={setWithdrawalPage}
                                    empty='No withdrawal requests.'
                                    label='Withdrawals table'
                                >
                                    {data.withdrawals.items.map(
                                        (withdrawal, index) => (
                                            <Table.Tr key={withdrawal.id}>
                                                <Table.Td>
                                                    {tableRowNumber(
                                                        withdrawalPage,
                                                        10,
                                                        index,
                                                    )}
                                                </Table.Td>
                                                <Table.Td>
                                                    {formatDateTime(
                                                        withdrawal.createdAt,
                                                    )}
                                                </Table.Td>
                                                <Table.Td className='admin-table-value'>
                                                    {accountingMoney(
                                                        withdrawal.amount,
                                                        withdrawal.currency,
                                                    )}
                                                </Table.Td>
                                                <Table.Td>
                                                    <Badge
                                                        color={
                                                            withdrawal.status ===
                                                            'paid'
                                                                ? 'green'
                                                                : withdrawal.status ===
                                                                    'rejected'
                                                                  ? 'red'
                                                                  : 'orange'
                                                        }
                                                    >
                                                        {withdrawal.status}
                                                    </Badge>
                                                </Table.Td>
                                                <Table.Td>
                                                    {withdrawal.reference ||
                                                        'Not recorded'}
                                                </Table.Td>
                                                <Table.Td>
                                                    <Group
                                                        gap='xs'
                                                        wrap='nowrap'
                                                    >
                                                        <Button
                                                            size='xs'
                                                            variant='subtle'
                                                            onClick={() =>
                                                                setAuditId(
                                                                    withdrawal.id,
                                                                )
                                                            }
                                                        >
                                                            Audit history
                                                        </Button>
                                                        {withdrawal.status ===
                                                            'reserved' && (
                                                            <Button
                                                                size='xs'
                                                                variant='light'
                                                                onClick={() =>
                                                                    setAction({
                                                                        action: 'approve',
                                                                        withdrawal,
                                                                    })
                                                                }
                                                            >
                                                                Approve
                                                            </Button>
                                                        )}
                                                        {(withdrawal.status ===
                                                            'reserved' ||
                                                            withdrawal.status ===
                                                                'approved') && (
                                                            <Button
                                                                size='xs'
                                                                variant='light'
                                                                color='red'
                                                                onClick={() =>
                                                                    setAction({
                                                                        action: 'reject',
                                                                        withdrawal,
                                                                    })
                                                                }
                                                            >
                                                                Reject
                                                            </Button>
                                                        )}
                                                        {withdrawal.status ===
                                                            'approved' && (
                                                            <Button
                                                                size='xs'
                                                                onClick={() =>
                                                                    setAction({
                                                                        action: 'paid',
                                                                        withdrawal,
                                                                    })
                                                                }
                                                            >
                                                                Record payout
                                                            </Button>
                                                        )}
                                                    </Group>
                                                </Table.Td>
                                            </Table.Tr>
                                        ),
                                    )}
                                </AccountingTable>
                            </Stack>
                        </Tabs.Panel>
                    </Tabs>
                </>
            ) : null}
            {editing && data && (
                <AgentForm
                    agent={data.agent}
                    onClose={() => setEditing(false)}
                    onSaved={() => {
                        setEditing(false);
                        refresh('Agent updated.');
                    }}
                />
            )}
            {addingAgreement && (
                <AgreementForm
                    agentId={id}
                    onClose={() => setAddingAgreement(false)}
                    onSaved={() => {
                        setAddingAgreement(false);
                        setAgreementPage(1);
                        refresh(
                            'Prospective agreement added. Historical earnings are unchanged.',
                        );
                    }}
                />
            )}
            {action && data && (
                <WithdrawalForm
                    agentId={id}
                    balances={data.statement.balances}
                    {...action}
                    onClose={() => setAction(null)}
                    onSaved={() => {
                        setAction(null);
                        setWithdrawalPage(1);
                        setStatementPage(1);
                        refresh('Withdrawal action recorded.');
                    }}
                />
            )}
            {auditId && (
                <WithdrawalAudit
                    agentId={id}
                    withdrawalId={auditId}
                    onClose={() => setAuditId(null)}
                />
            )}
            {journal && (
                <Modal
                    opened
                    onClose={() => setJournal(null)}
                    title='Journal source snapshot'
                    size='lg'
                >
                    <Stack>
                        <Text size='sm'>Journal: {journal.id}</Text>
                        <Text size='sm'>
                            Collection:{' '}
                            {journal.collectionId || 'Not applicable'}
                        </Text>
                        <Text size='sm'>
                            Withdrawal:{' '}
                            {journal.withdrawalId || 'Not applicable'}
                        </Text>
                        <Code
                            block
                            style={{
                                whiteSpace: 'pre-wrap',
                                overflowWrap: 'anywhere',
                            }}
                        >
                            {JSON.stringify(journal.snapshot, null, 2)}
                        </Code>
                    </Stack>
                </Modal>
            )}
            <Modal
                opened={statusModal}
                onClose={() => !statusBusy && setStatusModal(false)}
                title={active ? 'Archive agent' : 'Reactivate agent'}
                closeOnClickOutside={!statusBusy}
                closeOnEscape={!statusBusy}
            >
                <Stack>
                    {statusError && (
                        <Alert color='red' role='alert'>
                            {statusError}
                        </Alert>
                    )}
                    <Text>
                        {active
                            ? 'Stops new commission accrual and new withdrawal requests. Existing earnings, reservations and audit history are retained. Existing withdrawal decisions can still be processed.'
                            : 'Restores new accrual under applicable agreements and new withdrawal requests. No historical earnings are recalculated.'}
                    </Text>
                    <Checkbox
                        pb='xs'
                        label='I confirm this agent status change.'
                        checked={statusConfirmed}
                        onChange={(event) =>
                            setStatusConfirmed(event.currentTarget.checked)
                        }
                        disabled={statusBusy}
                    />
                    <Group justify='flex-end'>
                        <Button
                            variant='default'
                            disabled={statusBusy}
                            onClick={() => setStatusModal(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={() => void changeStatus()}
                            disabled={!statusConfirmed}
                            loading={statusBusy}
                        >
                            {active ? 'Archive agent' : 'Reactivate agent'}
                        </Button>
                    </Group>
                </Stack>
            </Modal>
        </PageLayout>
    );
}
