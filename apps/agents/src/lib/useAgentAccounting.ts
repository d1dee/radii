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

type Statement = Page<StatementRow> & { balances: Balance[] };
type AccountingData = {
    statement: Statement;
    profile: PayoutProfile | null;
    agreements: Page<AgreementRow> | null;
    withdrawals: Page<WithdrawalRow> | null;
    audit: Page<AccessEvent> | null;
    intent: WithdrawalIntent | null;
    earnings: Page<EarningsRow> | null;
    notifications: Page<NotificationRow> | null;
};

export function useAgentAccounting(
    agentId: string,
    tab: string,
    page: number,
    perPage: number,
    paused: boolean,
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
                tab === 'withdrawals'
                    ? request<Page<WithdrawalRow>>(
                          `${root}/withdrawals${query}`,
                          undefined,
                          controller.signal,
                      )
                    : Promise.resolve(null),
                tab === 'audit'
                    ? request<Page<AccessEvent>>(
                          `${root}/audit${query}`,
                          undefined,
                          controller.signal,
                      )
                    : Promise.resolve(null),
                readIntent(agentId, controller.signal),
                tab === 'earnings'
                    ? request<Page<EarningsRow>>(
                          `${root}/earnings${query}`,
                          undefined,
                          controller.signal,
                      )
                    : Promise.resolve(null),
                tab === 'notifications'
                    ? request<Page<NotificationRow>>(
                          `${root}/notifications${query}`,
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
    }, [agentId, tab, page, perPage, revision]);

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
