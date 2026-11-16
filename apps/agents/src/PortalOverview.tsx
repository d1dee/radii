import {
    Badge,
    Button,
    Collapse,
    Group,
    Paper,
    Select,
    Stack,
    Text,
    Title,
    Tooltip,
} from '@mantine/core';
import { useState } from 'react';
import { MdArrowOutward, MdExpandLess, MdExpandMore, MdReceiptLong, MdSouthWest } from 'react-icons/md';
import {
    BalanceSummary,
    dateTime,
    statusColor,
    type WithdrawalRow,
} from './AccountingViews';
import type { NotificationRow } from './PortalInsights';
import type { Balance, Page, PayoutProfile } from './api';
import { maskedBankAccount, maskedPhone } from './lib/maskedPhone';
import { cents, money } from './money';
import { WithdrawalAuditContent, type AuditEvent } from './WithdrawalAudit';
import { RecordFields } from './RecordDetails';

export type EarningsChartData = {
    month: string;
    items: { day: string; currency: string; earned: string }[];
};

export function EarningsChart({
    data,
    currency,
}: {
    data: EarningsChartData;
    currency: string | undefined;
}) {
    const [year, month] = data.month.split('-').map(Number);
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const daily = Array.from({ length: days }, () => 0n);
    for (const row of data.items) {
        if (row.currency === currency) {
            const day = Number(row.day.slice(-2)) - 1;
            if (day >= 0 && day < days) daily[day] += cents(row.earned);
        }
    }
    const total = daily.reduce((sum, amount) => sum + amount, 0n);
    const max = daily.reduce(
        (highest, amount) => (amount > highest ? amount : highest),
        0n,
    );
    const decimal = (amount: bigint) =>
        `${amount / 100n}.${String(amount % 100n).padStart(2, '0')}`;
    const monthLabel = new Date(
        Date.UTC(year, month - 1, 1),
    ).toLocaleDateString(undefined, {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
    });
    return (
        <Paper className='overview-performance' p={{ base: 'md', sm: 'lg' }}>
            <Group justify='space-between' align='flex-start'>
                <Stack gap={4}>
                    <Title order={3}>Earnings performance</Title>
                    <Text size='sm' c='dimmed'>
                        {monthLabel} (UTC)
                    </Text>
                </Stack>
                {currency && <Badge variant='light'>{currency}</Badge>}
            </Group>
            <Group align='baseline' gap='sm' mt='lg'>
                <Text className='chart-total money'>
                    {currency
                        ? money(decimal(total), currency)
                        : 'No earnings yet'}
                </Text>
                <Text size='xs' c='dimmed'>
                    earned last month
                </Text>
            </Group>
            <div
                className='earnings-chart'
                role='group'
                aria-label={`Daily earnings for ${monthLabel}${currency ? ` in ${currency}` : ''}`}
            >
                <div className='chart-grid' aria-hidden>
                    <span />
                    <span />
                    <span />
                </div>
                <div className='chart-bars'>
                    {daily.map((amount, index) => {
                        const label = `${monthLabel}, day ${index + 1}: ${currency ? money(decimal(amount), currency) : 'No earnings'}`;
                        return (
                            <Tooltip
                                key={index}
                                label={label}
                                events={{
                                    hover: true,
                                    focus: true,
                                    touch: true,
                                }}
                            >
                                <button
                                    type='button'
                                    className={`chart-bar${amount === 0n ? ' is-zero' : ''}`}
                                    aria-label={label}
                                    style={{
                                        height: `${max > 0n ? Math.max(2, Number((amount * 10000n) / max) / 100) : 2}%`,
                                    }}
                                />
                            </Tooltip>
                        );
                    })}
                </div>
            </div>
            <div className='chart-axis' aria-hidden>
                {[1, 5, 10, 15, 20, 25, days].map((day) => (
                    <span key={day}>{day}</span>
                ))}
            </div>
            <Group justify='space-between' mt='md' gap='xs'>
                <Text size='xs' c='dimmed'>
                    <span className='chart-legend' />
                    Confirmed commissions
                </Text>
                <Text size='xs' c='dimmed'>
                    Withdrawals do not reduce earnings
                </Text>
            </Group>
            {total === 0n && (
                <Text size='sm' c='dimmed' mt='sm'>
                    No commissions were recorded in this currency last month.
                </Text>
            )}
        </Paper>
    );
}

export function PortalOverview({
    balances,
    chart,
    profile,
    withdrawals,
    notifications,
    onPayout,
    onWithdrawal,
    withdrawalDetail,
}: {
    balances: Balance[];
    chart: EarningsChartData | null;
    profile: PayoutProfile | null;
    withdrawals: Page<WithdrawalRow> | null;
    notifications: Page<NotificationRow> | null;
    onPayout: () => void;
    onWithdrawal: (id: string | null) => void;
    withdrawalDetail: { withdrawal: WithdrawalRow; events: AuditEvent[] } | null;
}) {
    const [expanded, setExpanded] = useState<string | null>(null);
    function toggle(key: string, withdrawalId: string | null) {
        const opening = expanded !== key;
        setExpanded(opening ? key : null);
        onWithdrawal(opening ? withdrawalId : null);
    }
    function audit(id: string) {
        return withdrawalDetail?.withdrawal.id === id ? (
            <WithdrawalAuditContent {...withdrawalDetail} compact />
        ) : (
            <Text size='sm' role='status'>Loading withdrawal audit...</Text>
        );
    }
    const currencies = [
        ...new Set([
            ...balances.map((balance) => balance.currency),
            ...(chart?.items.map((row) => row.currency) ?? []),
        ]),
    ];
    const [selected, setSelected] = useState<string | null>(null);
    const currency =
        selected && currencies.includes(selected) ? selected : currencies[0];
    return (
        <>
            {currencies.length > 1 && (
                <Group justify='space-between'>
                    <Text size='sm' c='dimmed'>
                        Account balance & earnings
                    </Text>
                    <Select
                        aria-label='Account currency'
                        size='xs'
                        w={105}
                        data={currencies}
                        value={currency}
                        onChange={setSelected}
                        allowDeselect={false}
                    />
                </Group>
            )}
            <BalanceSummary
                balances={balances.filter(
                    (balance) => balance.currency === currency,
                )}
            />
            <div className='overview-grid'>
                {chart && <EarningsChart data={chart} currency={currency} />}
                <Paper
                    className='overview-destination'
                    p={{ base: 'md', sm: 'lg' }}
                >
                    <Title order={3}>Payout destinations</Title>

                    <Paper withBorder p='md' mt='md'>
                        <Group justify='space-between'>
                            <Title order={4}>
                                {profile ? (
                                    <span
                                        style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: 8,
                                        }}
                                    >
                                        {profile.method === 'mpesa' ? (
                                            <img
                                                src='/mpesa.png'
                                                alt='M-Pesa'
                                                width={104}
                                                height={38}
                                                style={{ objectFit: 'contain' }}
                                            />
                                        ) : (
                                            <span
                                                className='payout-bank-icon'
                                                aria-hidden
                                            />
                                        )}
                                        {profile.method === 'bank' &&
                                            'Bank transfer'}
                                    </span>
                                ) : (
                                    'Where should we send it?'
                                )}
                            </Title>
                            {profile && (
                                <Badge
                                    color={
                                        profile.verifiedAt ? 'green' : 'orange'
                                    }
                                    variant='light'
                                    ml='auto'
                                >
                                    {profile.verifiedAt
                                        ? 'Verified by operator'
                                        : 'Awaiting verification'}
                                </Badge>
                            )}
                        </Group>
                        {profile ? (
                            <>
                                <Text mt='xs' fw={500}>
                                    {profile.accountName}
                                </Text>
                                <Text size='sm' c='dimmed'>
                                    {profile.method === 'mpesa'
                                        ? maskedPhone(profile.destination)
                                        : maskedBankAccount(profile.destination)}
                                </Text>
                            </>
                        ) : (
                            <Text size='sm' c='dimmed' mt='xs'>
                                Add an M-Pesa number or bank account. Your
                                operator must verify it before your first
                                withdrawal.
                            </Text>
                        )}
                        <Button
                            mt='lg'
                            variant='default'
                            fullWidth
                            onClick={onPayout}
                        >
                            {profile
                                ? 'Manage destination'
                                : 'Set payout destination'}
                        </Button>
                    </Paper>
                    <Text size='xs' c='dimmed' mt='md'>
                        Payments are sent by your operator. Changing this
                        destination requires verification again.
                    </Text>
                </Paper>
                <Paper
                    className='overview-withdrawals'
                    p={{ base: 'md', sm: 'lg' }}
                >
                    <Group justify='space-between' mb='md'>
                        <Title order={3}>Recent withdrawals</Title>
                        <Button
                            component='a'
                            href='#statement'
                            size='xs'
                            variant='subtle'
                            rightSection={<MdArrowOutward />}
                        >
                            All statements
                        </Button>
                    </Group>
                    {!withdrawals?.items.length && (
                        <Text size='sm' c='dimmed' py='lg'>
                            No withdrawals yet. Your first request will appear
                            here.
                        </Text>
                    )}
                    {withdrawals?.items.map((row) => (
                        <div key={row.id}>
                        <div className='overview-list-row statement-row' onClick={() => toggle(`withdrawal-${row.id}`, row.id)}>
                            <span className='overview-row-icon' aria-hidden>
                                <MdSouthWest size={20} />
                            </span>
                            <Stack gap={2} className='overview-row-copy'>
                                <Text size='sm' fw={600} className='money'>
                                    {money(row.amount, row.currency)}
                                </Text>
                                <Text size='xs' c='dimmed'>
                                    {dateTime(row.createdAt)}
                                </Text>
                            </Stack>
                            <Badge
                                color={statusColor(row.status)}
                                variant='light'
                            >
                                {row.status}
                            </Badge>
                            <Button
                                variant='subtle'
                                size='xs'
                                onClick={(event) => {
                                    event.stopPropagation();
                                    toggle(`withdrawal-${row.id}`, row.id);
                                }}
                                aria-label={`${expanded === `withdrawal-${row.id}` ? 'Hide' : 'View'} withdrawal ${row.id}`}
                                aria-expanded={expanded === `withdrawal-${row.id}`}
                                aria-controls={`overview-withdrawal-${row.id}`}
                                rightSection={expanded === `withdrawal-${row.id}` ? <MdExpandLess /> : <MdExpandMore />}
                            >
                                {expanded === `withdrawal-${row.id}` ? 'Hide details' : 'View details'}
                            </Button>
                        </div>
                        <Collapse expanded={expanded === `withdrawal-${row.id}`}>
                            {expanded === `withdrawal-${row.id}` && (
                                <Stack id={`overview-withdrawal-${row.id}`} role='region' aria-label={`Withdrawal details ${row.id}`} p='md'>
                                    {audit(row.id)}
                                </Stack>
                            )}
                        </Collapse>
                        </div>
                    ))}
                    <Text size='xs' c='dimmed' mt='md'>
                        Approved means ready for processing, not paid. Rejected
                        requests return funds to your available balance.
                    </Text>
                </Paper>
                <Paper
                    className='overview-updates'
                    p={{ base: 'md', sm: 'lg' }}
                >
                    <Group justify='space-between' mb='md'>
                        <Title order={3}>Latest updates</Title>
                        <MdReceiptLong size={21} aria-hidden />
                    </Group>
                    {!notifications?.items.length && (
                        <Text size='sm' c='dimmed' py='lg'>
                            You are up to date. Account and withdrawal updates
                            will appear here.
                        </Text>
                    )}
                    {notifications?.items.map((row) => (
                        <div key={row.id} className='overview-update'>
                            <Text size='sm' fw={600}>
                                {row.title}
                            </Text>
                            <Text size='xs' c='dimmed' mt={3}>
                                {row.message}
                            </Text>
                            <Group justify='space-between' mt='xs'>
                                <Text size='xs' c='dimmed'>
                                    {dateTime(row.createdAt)}
                                </Text>
                                    <Button
                                        size='xs'
                                        variant='subtle'
                                        onClick={() =>
                                            toggle(`update-${row.id}`, row.withdrawalId)
                                        }
                                        aria-label={`${expanded === `update-${row.id}` ? 'Hide' : 'View'} update ${row.id}`}
                                        aria-expanded={expanded === `update-${row.id}`}
                                        aria-controls={`overview-update-${row.id}`}
                                        rightSection={expanded === `update-${row.id}` ? <MdExpandLess /> : <MdExpandMore />}
                                    >
                                        {expanded === `update-${row.id}` ? 'Hide details' : 'View details'}
                                    </Button>
                            </Group>
                            <Collapse expanded={expanded === `update-${row.id}`}>
                                {expanded === `update-${row.id}` && (
                                    <Stack id={`overview-update-${row.id}`} role='region' aria-label={`Update details ${row.id}`} p='md'>
                                        <RecordFields columns={2} fields={[
                                            ['Reference', row.id],
                                            ['Date', dateTime(row.createdAt)],
                                            ['Update', row.title],
                                            ['Message', row.message],
                                        ]} />
                                        {row.withdrawalId && audit(row.withdrawalId)}
                                    </Stack>
                                )}
                            </Collapse>
                        </div>
                    ))}
                </Paper>
            </div>
        </>
    );
}
