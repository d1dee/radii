import { useEffect, useEffectEvent, useState } from 'react';
import { request, type Balance, type Page, type PayoutProfile } from '../api';
import type {
    AccessEvent,
    AgreementRow,
    StatementRow,
    WithdrawalRow,
} from '../AccountingViews';
import { readIntent, type WithdrawalIntent } from '../withdrawalIntent';
import type { EarningsRow, NotificationRow } from '../PortalInsights';
import type { EarningsChartData } from '../PortalOverview';

type Statement = Page<StatementRow> & { balances: Balance[] };
export type ReportPaging = { page: number; perPage: number };
type AccountingData = {
    statement: Statement;
    profile: PayoutProfile | null;
    agreements: Page<AgreementRow> | null;
    withdrawals: Page<WithdrawalRow> | null;
    audit: Page<AccessEvent> | null;
    intent: WithdrawalIntent | null;
    earnings: Page<EarningsRow> | null;
    notifications: Page<NotificationRow> | null;
    chart: EarningsChartData | null;
};

export function useAgentAccounting(
    agentId: string,
    tab: string,
    page: number,
    perPage: number,
    paused: boolean,
    earningsPaging: ReportPaging,
    activityPaging: ReportPaging,
) {
    const [revision, setRevision] = useState(0);
    const [data, setData] = useState<AccountingData | null>(null);
    const [error, setError] = useState('');
    const shouldPause = useEffectEvent(
        () => paused || !!error || document.hidden,
    );
    useEffect(() => {
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout>;
        const root = `/${agentId}`;
        const query = `?page=${page}&perPage=${perPage}`;
        setData(null);
        setError('');
        function schedule() {
            timer = setTimeout(() => {
                if (shouldPause()) schedule();
                else load(true);
            }, 5000);
        }
        function load(background = false) {
            void Promise.all([
                request<Statement>(
                    `${root}/statement${tab === 'statement' ? query : '?page=1&perPage=10'}`,
                    undefined,
                    controller.signal,
                ),
                request<{ profile: PayoutProfile | null }>(
                    `${root}/payout-profile`,
                    undefined,
                    controller.signal,
                ),
                tab === 'agreements'
                    ? request<Page<AgreementRow>>(
                          `${root}/agreements${query}`,
                          undefined,
                          controller.signal,
                      )
                    : Promise.resolve(null),
                tab === 'overview'
                    ? request<Page<WithdrawalRow>>(
                          `${root}/withdrawals?page=1&perPage=5`,
                          undefined,
                          controller.signal,
                      )
                    : Promise.resolve(null),
                tab === 'statement'
                    ? request<Page<AccessEvent>>(
                          `${root}/audit?page=${activityPaging.page}&perPage=${activityPaging.perPage}`,
                          undefined,
                          controller.signal,
                      )
                    : Promise.resolve(null),
                readIntent(agentId, controller.signal),
                tab === 'statement'
                    ? request<Page<EarningsRow>>(
                          `${root}/earnings?page=${earningsPaging.page}&perPage=${earningsPaging.perPage}`,
                          undefined,
                          controller.signal,
                      )
                    : Promise.resolve(null),
                tab === 'overview'
                    ? request<Page<NotificationRow>>(
                          `${root}/notifications?page=1&perPage=5`,
                          undefined,
                          controller.signal,
                      )
                    : Promise.resolve(null),
                tab === 'overview'
                    ? request<EarningsChartData>(
                          `${root}/earnings-chart`,
                          undefined,
                          controller.signal,
                      )
                    : Promise.resolve(null),
            ])
                .then(
                    ([
                        statement,
                        payout,
                        agreements,
                        withdrawals,
                        audit,
                        recovery,
                        earnings,
                        notifications,
                        chart,
                    ]) => {
                        if (!controller.signal.aborted) {
                            if (background && shouldPause()) {
                                schedule();
                                return;
                            }
                            setData({
                                statement,
                                profile: payout.profile,
                                agreements,
                                withdrawals,
                                audit,
                                intent: recovery.intent,
                                earnings,
                                notifications,
                                chart,
                            });
                            setError('');
                            schedule();
                        }
                    },
                )
                .catch((err) => {
                    if (!controller.signal.aborted) {
                        setData(null);
                        setError(err.message);
                    }
                });
        }
        load();
        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [
        agentId,
        tab,
        page,
        perPage,
        revision,
        earningsPaging.page,
        earningsPaging.perPage,
        activityPaging.page,
        activityPaging.perPage,
    ]);

    return {
        data,
        error,
        revision,
        refresh: () => setRevision((value) => value + 1),
        fail: (message: string) => {
            setError(message);
            setData(null);
        },
    };
}
