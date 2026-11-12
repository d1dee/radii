import { Alert, Button, Paper, Stack, Table, Text, Title } from '@mantine/core';
import type { Balance, Page, PayoutProfile } from './api';
import { dateTime, type Paging } from './AccountingViews';
import { LedgerTable } from './LedgerTable';
import { money } from './money';
import { RecordDetails } from './RecordDetails';

export type EarningsRow = {
    id: string;
    month: string;
    scopeType: string | null;
    rateBps: number | null;
    currency: string;
    collections: number;
    collectionAmount: string;
    earned: string;
    firstEarnedAt: string;
    lastEarnedAt: string;
};
export type NotificationRow = {
    id: string;
    createdAt: string;
    title: string;
    message: string;
    withdrawalId: string | null;
};

export function EarningsBreakdown({
    data,
    paging,
}: {
    data: Page<EarningsRow>;
    paging: Paging;
}) {
    return (
        <Stack gap='sm'>
            <Text size='sm' c='dimmed'>
                Recorded commissions by month (UTC), source type and historical
                rate. Withdrawals do not reduce earnings in this report.
                Currencies are kept separate.
            </Text>
            <LedgerTable
                label='Earnings breakdown'
                headers={[
                    '#',
                    'Month (UTC)',
                    'Source',
                    'Rate',
                    'Collections',
                    'Collection basis',
                    'Earned',
                    'Details',
                ]}
                total={data.total}
                {...paging}
            >
                {data.items.map((row, index) => (
                    <Table.Tr key={row.id}>
                        <Table.Td>
                            {(paging.page - 1) * paging.perPage + index + 1}
                        </Table.Td>
                        <Table.Td>{row.month}</Table.Td>
                        <Table.Td>
                            {row.scopeType === 'nas'
                                ? 'NAS'
                                : row.scopeType === 'service_account'
                                  ? 'PPPoE service account'
                                  : 'Not recorded'}
                        </Table.Td>
                        <Table.Td>
                            {row.rateBps === null
                                ? 'Not recorded'
                                : `${(row.rateBps / 100).toFixed(2)}%`}
                        </Table.Td>
                        <Table.Td>{row.collections.toLocaleString()}</Table.Td>
                        <Table.Td className='money'>
                            {money(row.collectionAmount, row.currency)}
                        </Table.Td>
                        <Table.Td className='money'>
                            {money(row.earned, row.currency)}
                        </Table.Td>
                        <Table.Td>
                            <RecordDetails
                                title='Earnings group details'
                                fields={[
                                    ['Month (UTC)', row.month],
                                    [
                                        'Source',
                                        row.scopeType === 'nas'
                                            ? 'NAS'
                                            : row.scopeType ===
                                                'service_account'
                                              ? 'PPPoE service account'
                                              : null,
                                    ],
                                    [
                                        'Historical rate',
                                        row.rateBps === null
                                            ? null
                                            : `${(row.rateBps / 100).toFixed(2)}%`,
                                    ],
                                    [
                                        'Commission entries',
                                        String(row.collections),
                                    ],
                                    [
                                        'Confirmed collection basis',
                                        money(
                                            row.collectionAmount,
                                            row.currency,
                                        ),
                                    ],
                                    [
                                        'Commission earned',
                                        money(row.earned, row.currency),
                                    ],
                                    [
                                        'First earning',
                                        dateTime(row.firstEarnedAt),
                                    ],
                                    [
                                        'Last earning',
                                        dateTime(row.lastEarnedAt),
                                    ],
                                    [
                                        'Calculation',
                                        'Each commission uses the rate recorded at confirmation, rounded half up to the currency minor unit. Group totals sum the recorded commissions.',
                                    ],
                                ]}
                            />
                        </Table.Td>
                    </Table.Tr>
                ))}
            </LedgerTable>
        </Stack>
    );
}

export function NotificationsView({
    data,
    paging,
    onWithdrawal,
}: {
    data: Page<NotificationRow>;
    paging: Paging;
    onWithdrawal: (id: string) => void;
}) {
    return (
        <Stack gap='sm'>
            <Text size='sm' c='dimmed'>
                In-portal updates from your account and withdrawal history. This
                feed refreshes automatically; it does not send email or SMS.
            </Text>
            <LedgerTable
                label='Notifications'
                headers={['#', 'Date', 'Update', 'Message', 'Details']}
                total={data.total}
                {...paging}
            >
                {data.items.map((row, index) => (
                    <Table.Tr key={row.id}>
                        <Table.Td>
                            {(paging.page - 1) * paging.perPage + index + 1}
                        </Table.Td>
                        <Table.Td>{dateTime(row.createdAt)}</Table.Td>
                        <Table.Td>{row.title}</Table.Td>
                        <Table.Td>
                            <Text
                                size='sm'
                                maw={420}
                                style={{
                                    whiteSpace: 'normal',
                                    overflowWrap: 'anywhere',
                                }}
                            >
                                {row.message}
                            </Text>
                        </Table.Td>
                        <Table.Td>
                            {row.withdrawalId ? (
                                <Button
                                    size='xs'
                                    variant='subtle'
                                    onClick={() =>
                                        onWithdrawal(row.withdrawalId!)
                                    }
                                >
                                    View withdrawal
                                </Button>
                            ) : (
                                <RecordDetails
                                    title='Notification details'
                                    fields={[
                                        ['Reference', row.id],
                                        ['Date', dateTime(row.createdAt)],
                                        ['Update', row.title],
                                        ['Message', row.message],
                                    ]}
                                />
                            )}
                        </Table.Td>
                    </Table.Tr>
                ))}
            </LedgerTable>
        </Stack>
    );
}

export function WithdrawalGuidance({
    profile,
    balances,
}: {
    profile: PayoutProfile | null;
    balances: Balance[];
}) {
    return (
        <Paper withBorder p='md'>
            <Stack gap='sm'>
                <Title order={4}>Before you withdraw</Title>
                <Alert color={profile?.verifiedAt ? 'green' : 'orange'}>
                    {profile?.verifiedAt
                        ? 'Your current payout destination is verified.'
                        : profile
                          ? 'Your operator must verify your latest payout destination before you can request a withdrawal.'
                          : 'Add a payout destination and have your operator verify it before requesting a withdrawal.'}
                </Alert>
                {balances.map((balance) => (
                    <Text key={balance.currency} size='sm'>
                        Available: {money(balance.available, balance.currency)}.
                        Reserved: {money(balance.reserved, balance.currency)}.
                    </Text>
                ))}
                {!balances.length && (
                    <Text size='sm'>
                        No commission balance is available yet.
                    </Text>
                )}
                <Text size='sm'>
                    Request a positive amount up to your available balance in
                    the selected currency, and confirm your password. Reserved
                    funds cannot be withdrawn again.
                </Text>
                <Text size='sm'>
                    Reserved means awaiting review. Approved means authorized
                    for manual processing, not paid. Paid records an external
                    payment. Rejected requests release the reserved funds; see
                    the request history for the reason.
                </Text>
                <Text size='sm' c='dimmed'>
                    No additional minimum, fee or guaranteed processing time is
                    configured in this portal. Confirm any external transfer
                    charges and expected timing with your operator. Changing
                    your destination requires verification again and does not
                    change existing requests.
                </Text>
            </Stack>
        </Paper>
    );
}
