import {
    Alert,
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
    PayoutProfileView,
    StatementView,
    WithdrawalsView,
    type WithdrawalRow,
} from './AccountingViews';
import { request, type Membership } from './api';
import { PageLayout } from './components/PageLayout';
import { accountViews, type AccountView } from './components/PortalLayout';
import { useAgentAccounting } from './lib/useAgentAccounting';
import { WithdrawalAuditView, type AuditEvent } from './WithdrawalAudit';
import {
    EarningsBreakdown,
    NotificationsView,
    WithdrawalGuidance,
} from './PortalInsights';

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
    const [form, setForm] = useState<'withdrawal' | 'payout' | null>(null);
    const [detailId, setDetailId] = useState<string | null>(null);
    const [detail, setDetail] = useState<{
        withdrawal: WithdrawalRow;
        events: AuditEvent[];
    } | null>(null);
    const [detailError, setDetailError] = useState('');
    const agentId = membership.agentId;
    const { data, error, revision, refresh, fail } = useAgentAccounting(
        agentId,
        tab,
        page,
        perPage,
        form !== null || detailId !== null,
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
        setDetailError('');
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
                    setDetailError(err.message);
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
                        <Title order={3}>{view.title}</Title>
                        <Text size='sm' c='dimmed'>
                            {view.description}
                        </Text>
                    </Stack>
                    {tab !== 'payout' && tab !== 'security' && (
                        <Group gap='xs'>
                            <Button
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
                    {tab === 'earnings' && data.earnings && (
                        <EarningsBreakdown
                            data={data.earnings}
                            paging={paging}
                        />
                    )}
                    {tab === 'notifications' && data.notifications && (
                        <NotificationsView
                            data={data.notifications}
                            paging={paging}
                            onWithdrawal={setDetailId}
                        />
                    )}
                    {tab === 'withdrawals' && (
                        <WithdrawalGuidance
                            profile={data.profile}
                            balances={data.statement.balances}
                        />
                    )}
                    {pending && (
                        <Alert color='orange' role='status'>
                            Recover your saved withdrawal before starting
                            another.
                        </Alert>
                    )}
                    {tab !== 'payout' &&
                        tab !== 'security' &&
                        !data.profile?.verifiedAt && (
                            <Alert color='orange' role='note'>
                                Your operator must verify your payout
                                destination before new withdrawals.
                            </Alert>
                        )}
                    {tab === 'statement' && (
                        <StatementView data={data.statement} paging={paging} />
                    )}
                    {tab === 'agreements' && data.agreements && (
                        <AgreementsView
                            data={data.agreements}
                            paging={paging}
                        />
                    )}
                    {tab === 'withdrawals' && data.withdrawals && (
                        <WithdrawalsView
                            data={data.withdrawals}
                            paging={paging}
                            onDetail={setDetailId}
                        />
                    )}
                    {tab === 'audit' && data.audit && (
                        <AccountActivityView
                            data={data.audit}
                            paging={paging}
                        />
                    )}
                    {tab === 'payout' && (
                        <PayoutProfileView
                            profile={data.profile}
                            onUpdate={() => setForm('payout')}
                        />
                    )}
                </>
            )}
            {detailId && !detail && !detailError && (
                <Text role='status'>Loading withdrawal audit...</Text>
            )}
            {detail && data && !error && (
                <WithdrawalAuditView
                    {...detail}
                    destination={
                        detail.withdrawal.payout
                            ? `${detail.withdrawal.payout.method === 'mpesa' ? 'M-Pesa' : 'Bank'}: ${detail.withdrawal.payout.accountName}, ending in ${detail.withdrawal.payout.destination.slice(-4)}`
                            : undefined
                    }
                    onClose={() => {
                        setDetailId(null);
                        setDetail(null);
                    }}
                />
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
