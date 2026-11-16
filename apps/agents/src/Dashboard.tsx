import {
    Alert,
    Accordion,
    Anchor,
    Button,
    Center,
    Group,
    Loader,
    Stack,
    Text,
    Title,
} from '@mantine/core';
import { lazy, Suspense, useEffect, useEffectEvent, useState } from 'react';
import {
    AccountActivityView,
    AgreementsView,
    BalanceSummary,
    StatementView,
    type WithdrawalRow,
} from './AccountingViews';
import { request, type Membership } from './api';
import { PageLayout } from './components/PageLayout';
import { accountViews, type AccountView } from './components/PortalLayout';
import {
    useAgentAccounting,
    type ReportPaging,
} from './lib/useAgentAccounting';
import { type AuditEvent } from './WithdrawalAudit';
import { EarningsBreakdown } from './PortalInsights';
import { PortalOverview } from './PortalOverview';
import { MdArrowOutward } from 'react-icons/md';

const WithdrawalForm = lazy(() =>
    import('./WithdrawalForm').then((module) => ({
        default: module.WithdrawalForm,
    })),
);
const PayoutForm = lazy(() =>
    import('./PayoutForm').then((module) => ({ default: module.PayoutForm })),
);

export function Dashboard({
    userId,
    membership,
    tab,
}: {
    userId: string;
    membership: Membership;
    tab: AccountView;
}) {
    const [page, setPage] = useState(1);
    const [perPage, setPerPage] = useState(10);
    const [earningsPaging, setEarningsPaging] = useState<ReportPaging>({
        page: 1,
        perPage: 10,
    });
    const [activityPaging, setActivityPaging] = useState<ReportPaging>({
        page: 1,
        perPage: 10,
    });
    const [report, setReport] = useState<string | null>(null);
    const [form, setForm] = useState<'withdrawal' | 'payout' | null>(null);
    const [detailId, setDetailId] = useState<string | null>(null);
    const [detail, setDetail] = useState<{
        withdrawal: WithdrawalRow;
        events: AuditEvent[];
    } | null>(null);
    const agentId = membership.agentId;
    const { data, error, revision, refresh, fail } = useAgentAccounting(
        agentId,
        tab,
        page,
        perPage,
        form !== null || detailId !== null,
        earningsPaging,
        activityPaging,
    );
    const failAccount = useEffectEvent(fail);
    useEffect(() => {
        setDetailId(null);
        setDetail(null);
    }, [agentId, tab, page, perPage, revision]);
    useEffect(() => {
        if (!detailId) return;
        const controller = new AbortController();
        setDetail(null);
        request<{ withdrawal: WithdrawalRow; events: AuditEvent[] }>(
            `/${agentId}/withdrawals/${detailId}`,
            undefined,
            controller.signal,
        )
            .then((value) => {
                if (!controller.signal.aborted) setDetail(value);
            })
            .catch((err) => {
                if (!controller.signal.aborted) {
                    failAccount(err.message);
                }
            });
        return () => controller.abort();
    }, [agentId, detailId]);
    function saved() {
        setForm(null);
        setPage(1);
        refresh();
    }
    const pending = !!data?.intent;
    const view =
        accountViews.find((item) => item.value === tab) ?? accountViews[0];
    const paging = {
        page,
        perPage,
        onPage: setPage,
        onSize: (size: number) => {
            setPerPage(size);
            setPage(1);
        },
    };
    return (
        <PageLayout
            header={
                <Group
                    justify='space-between'
                    align='flex-start'
                    className='account-heading'
                >
                    <Stack gap={4}>
                        <Title order={1}>
                            {tab === 'overview'
                                ? `Welcome back, ${membership.name.split(' ')[0]}.`
                                : view.title}
                        </Title>
                        <Text size='sm' c='dimmed'>
                            {view.description}
                        </Text>
                    </Stack>
                    {tab !== 'security' && (
                        <Group gap='xs'>
                            <Button
                                className='withdrawal-button'
                                rightSection={<MdArrowOutward size={18} />}
                                disabled={
                                    !data ||
                                    (!data.profile?.verifiedAt && !pending)
                                }
                                onClick={() => setForm('withdrawal')}
                            >
                                {pending
                                    ? 'Recover saved withdrawal'
                                    : 'Request withdrawal'}
                            </Button>
                        </Group>
                    )}
                </Group>
            }
        >
            {error ? (
                <Alert color='red' role='alert'>
                    {error}
                    <Group mt='sm'>
                        <Button variant='default' onClick={refresh}>
                            Retry account
                        </Button>
                        <Anchor href='/login'>Sign in again</Anchor>
                    </Group>
                </Alert>
            ) : !data ? (
                <Center py='xl'>
                    <Loader aria-label='Loading agent accounting' />
                </Center>
            ) : (
                <>
                    {tab === 'statement' && (
                        <BalanceSummary balances={data.statement.balances} />
                    )}
                    {tab === 'overview' && (
                        <PortalOverview
                            profile={data.profile}
                            balances={data.statement.balances}
                            chart={data.chart}
                            withdrawals={data.withdrawals}
                            notifications={data.notifications}
                            onPayout={() => setForm('payout')}
                            onWithdrawal={setDetailId}
                            withdrawalDetail={detail}
                        />
                    )}
                    {pending && (
                        <Alert color='orange' role='status'>
                            Recover your saved withdrawal before starting
                            another.
                        </Alert>
                    )}
                    {tab !== 'security' && !data.profile?.verifiedAt && (
                        <Alert color='orange' role='note'>
                            Your operator must verify your payout destination
                            before new withdrawals.
                        </Alert>
                    )}
                    {tab === 'statement' && (
                        <StatementView
                            data={data.statement}
                            paging={paging}
                            onWithdrawal={setDetailId}
                            withdrawalDetail={detail}
                        />
                    )}
                    {tab === 'agreements' && data.agreements && (
                        <AgreementsView
                            data={data.agreements}
                            paging={paging}
                        />
                    )}
                    {tab === 'statement' && (
                        <Accordion
                            variant='separated'
                            value={report}
                            onChange={setReport}
                        >
                            <Accordion.Item value='earnings'>
                                <Accordion.Control>
                                    Earnings by month, source and rate
                                </Accordion.Control>
                                <Accordion.Panel>
                                    {data.earnings && (
                                        <EarningsBreakdown
                                            data={data.earnings}
                                            paging={{
                                                ...earningsPaging,
                                                onPage: (page) =>
                                                    setEarningsPaging(
                                                        (current) => ({
                                                            ...current,
                                                            page,
                                                        }),
                                                    ),
                                                onSize: (perPage) =>
                                                    setEarningsPaging({
                                                        page: 1,
                                                        perPage,
                                                    }),
                                            }}
                                        />
                                    )}
                                </Accordion.Panel>
                            </Accordion.Item>
                            <Accordion.Item value='activity'>
                                <Accordion.Control>
                                    Account activity history
                                </Accordion.Control>
                                <Accordion.Panel>
                                    {data.audit && (
                                        <AccountActivityView
                                            data={data.audit}
                                            paging={{
                                                ...activityPaging,
                                                onPage: (page) =>
                                                    setActivityPaging(
                                                        (current) => ({
                                                            ...current,
                                                            page,
                                                        }),
                                                    ),
                                                onSize: (perPage) =>
                                                    setActivityPaging({
                                                        page: 1,
                                                        perPage,
                                                    }),
                                            }}
                                        />
                                    )}
                                </Accordion.Panel>
                            </Accordion.Item>
                        </Accordion>
                    )}
                </>
            )}
            <Suspense
                fallback={<Text role='status'>Loading secure form...</Text>}
            >
                {form === 'withdrawal' && data && (
                    <WithdrawalForm
                        key={`${userId}:${agentId}`}
                        agentId={agentId}
                        balances={data.statement.balances}
                        canRequest={!!data.profile?.verifiedAt}
                        onClose={() => {
                            setForm(null);
                            refresh();
                        }}
                        onSaved={saved}
                    />
                )}
                {form === 'payout' && data && (
                    <PayoutForm
                        agentId={agentId}
                        onClose={() => setForm(null)}
                        onSaved={saved}
                    />
                )}
            </Suspense>
        </PageLayout>
    );
}
