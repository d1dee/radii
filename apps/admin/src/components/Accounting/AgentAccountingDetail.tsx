import {
    Alert,
    Badge,
    Button,
    Card,
    Center,
    Checkbox,
    Drawer,
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
import { MdCheck, MdClose, MdHistory, MdPayments } from 'react-icons/md';
import { TableRowActions } from '@/components/TableRowActions';
import { AccountingRow, AccountingTable } from './AccountingTable';
import classes from './Accounting.module.css';
import { AgentForm } from './AgentForm';
import { AgentPortalAccess } from './AgentPortalAccess';
import { AgreementForm } from './AgreementForm';
import { WithdrawalAudit } from './WithdrawalAudit';
import { WithdrawalForm } from './WithdrawalForm';
import {
    getAgent,
    getAgentStatement,
    getWithdrawalIntent,
    listAgreements,
    listWithdrawals,
    updateAgent,
    type AccountingPage,
    type Agent,
    type AgentAgreementDetail,
    type AgentJournal,
    type AgentStatement,
    type AgentWithdrawal,
} from '@/lib/accountingApi';
import { accountingMoney } from '@/lib/accountingMoney';
import { formatDateTime } from '@/lib/format';
import { tableRowNumber } from '@/lib/pagination';

type Detail = {
    agent: Agent;
    statement: AgentStatement;
    agreements: AccountingPage<AgentAgreementDetail>;
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
const accountLabels: Record<string, string> = {
    commission_expense: 'Commission expense',
    available: 'Available balance',
    reserved: 'Reserved balance',
    external_payment: 'External payout',
};

export function AgentAccountingDetail({
    id,
    onAgentUpdated,
    onClose,
}: {
    id: string;
    onAgentUpdated?: (agent: Agent) => void;
    onClose: () => void;
}) {
    const [data, setData] = useState<Detail | null>(null);
    const [opened, setOpened] = useState(false);
    useEffect(() => setOpened(true), []);
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
    const [action, setAction] = useState<FinancialAction | null>(null);
    useEffect(() => {
        let cancelled = false;
        void getWithdrawalIntent(id).then((result) => {
            if (!cancelled && result.success && result.data?.intent)
                setAction({ action: 'request' });
        });
        return () => {
            cancelled = true;
        };
    }, [id]);
    const [auditId, setAuditId] = useState<string | null>(null);
    const [journal, setJournal] = useState<AgentJournal | null>(null);
    const [agreement, setAgreement] = useState<AgentAgreementDetail | null>(
        null,
    );
    const [portalDialogOpen, setPortalDialogOpen] = useState(false);
    const [notice, setNotice] = useState('');
    const [tab, setTab] = useState<string | null>('statement');
    const dialogOpen =
        editing ||
        addingAgreement ||
        statusModal ||
        !!action ||
        !!auditId ||
        !!journal ||
        !!agreement ||
        portalDialogOpen;
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
        if (result.data) onAgentUpdated?.(result.data);
        refresh('Agent status updated.');
    }
    const active = data?.agent.status === 'active';
    return (
        <Drawer
            opened={opened}
            onClose={() => setOpened(false)}
            onExitTransitionEnd={onClose}
            position='right'
            size='min(1100px, 100%)'
            closeOnEscape={!dialogOpen}
            closeOnClickOutside={!dialogOpen}
            styles={{
                body: { overflowWrap: 'anywhere' },
                title: { minWidth: 0, flex: 1 },
                close: { flexShrink: 0 },
            }}
            title={
                <Group gap='sm' align='center' wrap='wrap'>
                    <Stack gap={2} style={{ flex: '1 1 180px', minWidth: 0 }}>
                        <Title
                            component='span'
                            order={3}
                            style={{ overflowWrap: 'anywhere' }}
                        >
                            {data?.agent.name ?? 'Agent accounting'}
                        </Title>
                        {data?.agent.phone && (
                            <Text size='xs' c='dimmed'>
                                {data.agent.phone}
                            </Text>
                        )}
                    </Stack>
                    <Group gap='xs' justify='flex-end' ml='auto' pr='xs'>
                        <Button
                            size='xs'
                            variant='default'
                            onClick={() => refresh()}
                            disabled={loading}
                        >
                            Refresh account
                        </Button>
                        {data && (
                            <>
                                <Button
                                    size='xs'
                                    variant='light'
                                    onClick={() => setEditing(true)}
                                    disabled={loading}
                                >
                                    Edit agent
                                </Button>
                                <Button
                                    size='xs'
                                    variant='light'
                                    color={active ? 'orange' : 'green'}
                                    disabled={loading}
                                    onClick={() => {
                                        setStatusConfirmed(false);
                                        setStatusError('');
                                        setStatusModal(true);
                                    }}
                                >
                                    {active
                                        ? 'Archive agent'
                                        : 'Reactivate agent'}
                                </Button>
                            </>
                        )}
                    </Group>
                </Group>
            }
        >
            <Stack className={classes.detail} gap='md'>
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
                                Archived agents earn no new commission and
                                cannot request new withdrawals. Historical
                                balances and existing withdrawal decisions
                                remain available.
                            </Alert>
                        )}
                        <Stack gap='sm' aria-label='Agent balances'>
                            {data.statement.balances.length === 0 ? (
                                <Alert color='gray'>
                                    No earnings yet. Balances appear after
                                    eligible confirmed collections.
                                </Alert>
                            ) : (
                                data.statement.balances.map((balance) => (
                                    <Card withBorder key={balance.currency}>
                                        <Text fw={600} mb='sm'>
                                            {balance.currency} balances
                                        </Text>
                                        <SimpleGrid
                                            cols={{ base: 1, xs: 2, sm: 4 }}
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
                            separated by currency. Reserved funds include
                            approved withdrawals. No balance can be edited here.
                        </Text>
                        <Tabs value={tab} onChange={setTab} keepMounted={false}>
                            <Tabs.List className={classes.tabs}>
                                <Tabs.Tab value='statement'>Statement</Tabs.Tab>
                                <Tabs.Tab value='agreements'>
                                    Agreements
                                </Tabs.Tab>
                                <Tabs.Tab value='withdrawals'>
                                    Withdrawals
                                </Tabs.Tab>
                                <Tabs.Tab value='portal'>
                                    Portal access
                                </Tabs.Tab>
                            </Tabs.List>
                            <Tabs.Panel value='statement' pt='md'>
                                <Stack>
                                    <Text size='sm' c='dimmed'>
                                        Each row records equal debit and credit
                                        entries. Open its source details to
                                        inspect collection and agreement
                                        attribution.
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
                                                <AccountingRow
                                                    key={entry.id}
                                                    label={`View ${journalLabels[entry.kind]} details`}
                                                    onOpen={() =>
                                                        setJournal(entry)
                                                    }
                                                >
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
                                                        {
                                                            journalLabels[
                                                                entry.kind
                                                            ]
                                                        }
                                                    </Table.Td>
                                                    <Table.Td className='admin-table-value'>
                                                        {accountingMoney(
                                                            entry.amount,
                                                            entry.currency,
                                                        )}
                                                    </Table.Td>
                                                    <Table.Td>
                                                        {accountLabels[
                                                            entry.debitAccount
                                                        ] ?? 'Other account'}
                                                    </Table.Td>
                                                    <Table.Td>
                                                        {accountLabels[
                                                            entry.creditAccount
                                                        ] ?? 'Other account'}
                                                    </Table.Td>
                                                    <Table.Td>
                                                        <Button
                                                            variant='subtle'
                                                            size='xs'
                                                            onClick={() =>
                                                                setJournal(
                                                                    entry,
                                                                )
                                                            }
                                                        >
                                                            View details
                                                        </Button>
                                                    </Table.Td>
                                                </AccountingRow>
                                            ),
                                        )}
                                    </AccountingTable>
                                </Stack>
                            </Tabs.Panel>
                            <Tabs.Panel value='agreements' pt='md'>
                                <Stack>
                                    <Group justify='space-between'>
                                        <Text size='sm' c='dimmed'>
                                            Immutable rate versions. Future
                                            versions supersede the scope, not
                                            historical earnings.
                                        </Text>
                                        <Button
                                            onClick={() =>
                                                setAddingAgreement(true)
                                            }
                                            disabled={!active}
                                        >
                                            Add agreement
                                        </Button>
                                    </Group>
                                    <AccountingTable
                                        headers={[
                                            '#',
                                            'Scope',
                                            'Assigned to',
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
                                                <AccountingRow
                                                    key={agreement.id}
                                                    label='View commission agreement'
                                                    onOpen={() =>
                                                        setAgreement(agreement)
                                                    }
                                                >
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
                                                        <Stack gap={2}>
                                                            <Text size='sm'>
                                                                {agreement.scopeLabel ||
                                                                    'Scope no longer available'}
                                                            </Text>
                                                            {agreement.scopeDetail && (
                                                                <Text
                                                                    size='xs'
                                                                    c='dimmed'
                                                                >
                                                                    {
                                                                        agreement.scopeDetail
                                                                    }
                                                                </Text>
                                                            )}
                                                        </Stack>
                                                    </Table.Td>
                                                    <Table.Td>
                                                        {(
                                                            agreement.rateBps /
                                                            100
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
                                                        <Stack gap={2}>
                                                            <Text size='sm'>
                                                                {agreement.actorName ||
                                                                    agreement.actorEmail ||
                                                                    'Administrator no longer available'}
                                                            </Text>
                                                            {agreement.actorName &&
                                                                agreement.actorEmail && (
                                                                    <Text
                                                                        size='xs'
                                                                        c='dimmed'
                                                                    >
                                                                        {
                                                                            agreement.actorEmail
                                                                        }
                                                                    </Text>
                                                                )}
                                                        </Stack>
                                                    </Table.Td>
                                                </AccountingRow>
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
                                            rejections and externally paid
                                            receipts. No automatic B2C.
                                        </Text>
                                        <Button
                                            onClick={() =>
                                                setAction({ action: 'request' })
                                            }
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
                                                <AccountingRow
                                                    key={withdrawal.id}
                                                    label={`View ${withdrawal.status} withdrawal audit`}
                                                    onOpen={() =>
                                                        setAuditId(
                                                            withdrawal.id,
                                                        )
                                                    }
                                                >
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
                                                    <Table.Td className='admin-table-actions'>
                                                        <TableRowActions
                                                            actions={[
                                                                {
                                                                    label: 'Audit history',
                                                                    icon: (
                                                                        <MdHistory
                                                                            size={
                                                                                18
                                                                            }
                                                                        />
                                                                    ),
                                                                    onClick:
                                                                        () =>
                                                                            setAuditId(
                                                                                withdrawal.id,
                                                                            ),
                                                                },
                                                                ...(withdrawal.status ===
                                                                'reserved'
                                                                    ? [
                                                                          {
                                                                              label: 'Approve',
                                                                              icon: (
                                                                                  <MdCheck
                                                                                      size={
                                                                                          18
                                                                                      }
                                                                                  />
                                                                              ),
                                                                              onClick:
                                                                                  () =>
                                                                                      setAction(
                                                                                          {
                                                                                              action: 'approve',
                                                                                              withdrawal,
                                                                                          },
                                                                                      ),
                                                                          },
                                                                      ]
                                                                    : []),
                                                                ...([
                                                                    'reserved',
                                                                    'approved',
                                                                ].includes(
                                                                    withdrawal.status,
                                                                )
                                                                    ? [
                                                                          {
                                                                              label: 'Reject',
                                                                              icon: (
                                                                                  <MdClose
                                                                                      size={
                                                                                          18
                                                                                      }
                                                                                  />
                                                                              ),
                                                                              color: 'red',
                                                                              onClick:
                                                                                  () =>
                                                                                      setAction(
                                                                                          {
                                                                                              action: 'reject',
                                                                                              withdrawal,
                                                                                          },
                                                                                      ),
                                                                          },
                                                                      ]
                                                                    : []),
                                                                ...(withdrawal.status ===
                                                                'approved'
                                                                    ? [
                                                                          {
                                                                              label: 'Record payout',
                                                                              icon: (
                                                                                  <MdPayments
                                                                                      size={
                                                                                          18
                                                                                      }
                                                                                  />
                                                                              ),
                                                                              onClick:
                                                                                  () =>
                                                                                      setAction(
                                                                                          {
                                                                                              action: 'paid',
                                                                                              withdrawal,
                                                                                          },
                                                                                      ),
                                                                          },
                                                                      ]
                                                                    : []),
                                                            ]}
                                                        />
                                                    </Table.Td>
                                                </AccountingRow>
                                            ),
                                        )}
                                    </AccountingTable>
                                </Stack>
                            </Tabs.Panel>
                            <Tabs.Panel value='portal' pt='md'>
                                <AgentPortalAccess
                                    key={id}
                                    agent={data.agent}
                                    onDialogChange={setPortalDialogOpen}
                                />
                            </Tabs.Panel>
                        </Tabs>
                    </>
                ) : null}
                {editing && data && (
                    <AgentForm
                        agent={data.agent}
                        onClose={() => setEditing(false)}
                        onSaved={(updated) => {
                            setEditing(false);
                            onAgentUpdated?.(updated);
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
                        key={`${id}:${action.action}:${action.withdrawal?.id ?? 'request'}`}
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
                        title={journalLabels[journal.kind]}
                        size='lg'
                    >
                        <Stack>
                            <Text fw={600}>
                                {accountingMoney(
                                    journal.amount,
                                    journal.currency,
                                )}
                            </Text>
                            <Text size='sm'>
                                Recorded {formatDateTime(journal.createdAt)}
                            </Text>
                            <Text size='sm'>
                                Debit:{' '}
                                {accountLabels[journal.debitAccount] ??
                                    'Other account'}
                            </Text>
                            <Text size='sm'>
                                Credit:{' '}
                                {accountLabels[journal.creditAccount] ??
                                    'Other account'}
                            </Text>
                            {journal.kind === 'accrual' && (
                                <>
                                    <Title order={5}>
                                        Confirmed collection
                                    </Title>
                                    {typeof journal.snapshot
                                        .collectionAmount === 'string' && (
                                        <Text size='sm'>
                                            Gross collection:{' '}
                                            {accountingMoney(
                                                journal.snapshot
                                                    .collectionAmount,
                                                journal.currency,
                                            )}
                                        </Text>
                                    )}
                                    {typeof journal.snapshot.rateBps ===
                                        'number' && (
                                        <Text size='sm'>
                                            Commission rate:{' '}
                                            {(
                                                journal.snapshot.rateBps / 100
                                            ).toFixed(2)}
                                            %
                                        </Text>
                                    )}
                                    {typeof journal.snapshot
                                        .collectionRecordedAt === 'string' && (
                                        <Text size='sm'>
                                            Collection confirmed{' '}
                                            {formatDateTime(
                                                journal.snapshot
                                                    .collectionRecordedAt,
                                            )}
                                        </Text>
                                    )}
                                    {typeof journal.snapshot.effectiveFrom ===
                                        'string' && (
                                        <Text size='sm'>
                                            Agreement effective from{' '}
                                            {formatDateTime(
                                                journal.snapshot.effectiveFrom,
                                            )}
                                        </Text>
                                    )}
                                    {journal.collection ? (
                                        <>
                                            <Text size='sm'>
                                                Customer:{' '}
                                                {journal.collection
                                                    .customerName ||
                                                    journal.collection
                                                        .customerPhone ||
                                                    'Customer no longer available'}
                                            </Text>
                                            {journal.collection
                                                .customerPhone && (
                                                <Text size='sm'>
                                                    Phone:{' '}
                                                    {
                                                        journal.collection
                                                            .customerPhone
                                                    }
                                                </Text>
                                            )}
                                            <Text size='sm'>
                                                NAS device:{' '}
                                                {journal.collection.nasName ||
                                                    'Not available'}
                                            </Text>
                                            {(journal.collection.serviceLabel ||
                                                journal.collection
                                                    .serviceUsername) && (
                                                <Text size='sm'>
                                                    Service account:{' '}
                                                    {journal.collection
                                                        .serviceLabel ||
                                                        journal.collection
                                                            .serviceUsername}
                                                    {journal.collection
                                                        .serviceLabel &&
                                                    journal.collection
                                                        .serviceUsername
                                                        ? ` (${journal.collection.serviceUsername})`
                                                        : ''}
                                                </Text>
                                            )}
                                            <Text size='sm'>
                                                Provider:{' '}
                                                {journal.collection.provider}
                                            </Text>
                                            <Text size='sm'>
                                                Payment reference:{' '}
                                                {journal.collection.reference ||
                                                    'Not recorded'}
                                            </Text>
                                            <Text size='xs' c='dimmed'>
                                                Customer and assignment details
                                                reflect current records. The
                                                collection amount and commission
                                                rate above are the historical
                                                snapshot.
                                            </Text>
                                        </>
                                    ) : (
                                        <Alert color='gray'>
                                            Source collection details are no
                                            longer available. Historical
                                            commission details are retained
                                            above.
                                        </Alert>
                                    )}
                                </>
                            )}
                            {journal.withdrawalId && (
                                <>
                                    <Title order={5}>Withdrawal</Title>
                                    {journal.withdrawal ? (
                                        <>
                                            <Text size='sm'>
                                                Requested{' '}
                                                {formatDateTime(
                                                    journal.withdrawal
                                                        .createdAt,
                                                )}
                                            </Text>
                                            <Text size='sm'>
                                                Amount:{' '}
                                                {accountingMoney(
                                                    journal.withdrawal.amount,
                                                    journal.withdrawal.currency,
                                                )}
                                            </Text>
                                            <Text size='sm' tt='capitalize'>
                                                Current status:{' '}
                                                {journal.withdrawal.status}
                                            </Text>
                                            {journal.withdrawal.reference && (
                                                <Text size='sm'>
                                                    Payout reference:{' '}
                                                    {
                                                        journal.withdrawal
                                                            .reference
                                                    }
                                                </Text>
                                            )}
                                        </>
                                    ) : (
                                        <Text size='sm' c='dimmed'>
                                            Withdrawal details are no longer
                                            available.
                                        </Text>
                                    )}
                                    <Button
                                        variant='light'
                                        onClick={() => {
                                            setAuditId(journal.withdrawalId);
                                            setJournal(null);
                                        }}
                                    >
                                        View withdrawal audit
                                    </Button>
                                </>
                            )}
                            {(
                                [
                                    'note',
                                    'reason',
                                    'reference',
                                    'evidence',
                                ] as const
                            ).map((field) =>
                                typeof journal.snapshot[field] === 'string' &&
                                journal.snapshot[field] ? (
                                    <Text
                                        key={field}
                                        size='sm'
                                        style={{
                                            whiteSpace: 'pre-wrap',
                                            overflowWrap: 'anywhere',
                                        }}
                                    >
                                        {field === 'reference'
                                            ? 'Movement reference'
                                            : field.charAt(0).toUpperCase() +
                                              field.slice(1)}
                                        : {journal.snapshot[field]}
                                    </Text>
                                ) : null,
                            )}
                        </Stack>
                    </Modal>
                )}
                {agreement && (
                    <Modal
                        opened
                        onClose={() => setAgreement(null)}
                        title='Commission agreement'
                        size='lg'
                    >
                        <Stack>
                            <Text fw={600}>
                                {(agreement.rateBps / 100).toFixed(2)}% of
                                confirmed gross collections
                            </Text>
                            <Text size='sm'>
                                Scope:{' '}
                                {agreement.scopeType === 'nas'
                                    ? 'NAS device'
                                    : 'Service account'}
                            </Text>
                            <Text size='sm'>
                                {agreement.scopeLabel ||
                                    'Scope no longer available'}
                            </Text>
                            {agreement.scopeDetail && (
                                <Text size='sm' c='dimmed'>
                                    {agreement.scopeDetail}
                                </Text>
                            )}
                            <Text size='sm'>
                                Effective from{' '}
                                {formatDateTime(agreement.effectiveFrom)}
                            </Text>
                            <Text size='sm'>
                                Recorded {formatDateTime(agreement.createdAt)}
                            </Text>
                            <Text size='sm'>
                                Recorded by:{' '}
                                {agreement.actorName ||
                                    agreement.actorEmail ||
                                    'Administrator no longer available'}
                            </Text>
                            {agreement.actorName && agreement.actorEmail && (
                                <Text size='sm' c='dimmed'>
                                    {agreement.actorEmail}
                                </Text>
                            )}
                            <Alert color='blue'>
                                This rate version is immutable. Add a new
                                agreement to change future commission without
                                rewriting historical earnings.
                            </Alert>
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
            </Stack>
        </Drawer>
    );
}
