import {
    Badge,
    Box,
    Button,
    Divider,
    Group,
    Paper,
    SimpleGrid,
    Stack,
    Table,
    Text,
    ThemeIcon,
    Title,
    Tooltip,
} from '@mantine/core';
import { Fragment, useEffect, useState } from 'react';
import {
    MdAccountBalance,
    MdCheckCircle,
    MdExpandLess,
    MdExpandMore,
    MdPhoneAndroid,
    MdSchedule,
    MdWallet,
} from 'react-icons/md';
import type { Balance, Page, PayoutProfile } from './api';
import { LedgerTable } from './LedgerTable';
import { maskedBankAccount, maskedPhone } from './lib/maskedPhone';
import { money } from './money';
import { ExpandableTableRow, RecordFields } from './RecordDetails';
import { WithdrawalAuditContent, type AuditEvent } from './WithdrawalAudit';

export const dateTime = (value: string) =>
    new Date(value).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
    });
export const statusColor = (status: string) =>
    status === 'paid' || status === 'verified'
        ? 'green'
        : status === 'rejected' || status === 'revoked'
          ? 'red'
          : 'orange';
export type StatementRow = {
    id: string;
    createdAt: string;
    kind: string;
    amount: string;
    currency: string;
    withdrawalId?: string | null;
    source: null | {
        rateBps: number;
        basis: string;
        scopeType: string;
        collectionAmount: string;
        collectionRecordedAt: string;
        agreementEffectiveFrom?: string | null;
        rounding?: string | null;
        entitlementRule?: string | null;
    };
};
export type AgreementRow = {
    id: string;
    scopeType: string;
    rateBps: number;
    basis: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    isCurrent: boolean;
    createdAt?: string;
};
export type WithdrawalRow = {
    id: string;
    createdAt: string;
    amount: string;
    currency: string;
    status: string;
    note: string | null;
    updatedAt?: string;
    reference?: string | null;
    payout: null | {
        method: 'mpesa' | 'bank';
        accountName: string;
        destination: string;
    };
};
export type Paging = {
    page: number;
    perPage: number;
    onPage: (page: number) => void;
    onSize: (size: number) => void;
};
export type AccessEvent = {
    id: string;
    action: string;
    actorType: 'ADMIN' | 'AGENT';
    createdAt: string;
};

export function AccountActivityView({
    data,
    paging,
}: {
    data: Page<AccessEvent>;
    paging: Paging;
}) {
    return (
        <Stack>
            <LedgerTable
                label='Account activity'
                headers={['#', 'Date', 'Activity', 'Actor', 'Details']}
                total={data.total}
                {...paging}
            >
                {data.items.map((event, index) => (
                    <ExpandableTableRow
                        key={`${paging.page}:${paging.perPage}:${event.id}`}
                        id={`activity-${event.id}`}
                        title='Account activity details'
                        colSpan={5}
                        details={
                            <RecordFields
                                columns={2}
                                fields={[
                                    ['Event reference', event.id],
                                    ['Recorded', dateTime(event.createdAt)],
                                    [
                                        'Activity',
                                        event.action.replaceAll('_', ' '),
                                    ],
                                    [
                                        'Actor',
                                        event.actorType === 'ADMIN'
                                            ? 'Operator'
                                            : 'Agent',
                                    ],
                                ]}
                            />
                        }
                    >
                        <Table.Td>
                            {(paging.page - 1) * paging.perPage + index + 1}
                        </Table.Td>
                        <Table.Td>{dateTime(event.createdAt)}</Table.Td>
                        <Table.Td>{event.action.replaceAll('_', ' ')}</Table.Td>
                        <Table.Td>
                            {event.actorType === 'ADMIN' ? 'Operator' : 'Agent'}
                        </Table.Td>
                    </ExpandableTableRow>
                ))}
            </LedgerTable>
        </Stack>
    );
}

export function PayoutProfileView({
    profile,
    onUpdate,
}: {
    profile: PayoutProfile | null;
    onUpdate: () => void;
}) {
    if (!profile) {
        return (
            <Paper
                withBorder
                p={{ base: 'lg', sm: 'xl' }}
                className='payout-summary'
            >
                <Stack align='center' gap='sm' py='xl' ta='center'>
                    <ThemeIcon
                        size={56}
                        radius='md'
                        variant='light'
                        color='blue'
                    >
                        <MdWallet size={28} aria-hidden />
                    </ThemeIcon>
                    <Title order={4}>Add a payout destination</Title>
                    <Text size='sm' c='dimmed' maw={360}>
                        Use an M-Pesa number or bank account in your name. Your
                        operator will verify it before withdrawals.
                    </Text>
                    <Button mt='xs' onClick={onUpdate}>
                        Set payout destination
                    </Button>
                </Stack>
            </Paper>
        );
    }
    const verified = !!profile.verifiedAt;
    const MethodIcon =
        profile.method === 'mpesa' ? MdPhoneAndroid : MdAccountBalance;
    return (
        <Paper withBorder className='payout-summary'>
            <Box p={{ base: 'md', sm: 'lg' }}>
                <Group justify='space-between' gap='md' align='flex-start'>
                    <Group gap='sm' wrap='nowrap'>
                        <ThemeIcon
                            size={44}
                            radius='md'
                            variant='light'
                            color='blue'
                        >
                            <MethodIcon size={24} aria-hidden />
                        </ThemeIcon>
                        <Stack gap={2}>
                            <Title order={4}>
                                {profile.method === 'mpesa'
                                    ? 'M-Pesa'
                                    : 'Bank transfer'}
                            </Title>
                            <Text size='sm' c='dimmed'>
                                Withdrawal destination
                            </Text>
                        </Stack>
                    </Group>
                    <Badge
                        variant='light'
                        color={verified ? 'green' : 'orange'}
                        leftSection={
                            verified ? (
                                <MdCheckCircle size={14} aria-hidden />
                            ) : (
                                <MdSchedule size={14} aria-hidden />
                            )
                        }
                    >
                        {verified
                            ? 'Verified by operator'
                            : 'Awaiting verification'}
                    </Badge>
                </Group>
            </Box>
            <Divider />
            <Box p={{ base: 'md', sm: 'lg' }}>
                <SimpleGrid
                    component='dl'
                    m={0}
                    cols={{ base: 1, sm: 2 }}
                    spacing='lg'
                    verticalSpacing='lg'
                >
                    {[
                        ['Account holder', profile.accountName],
                        [
                            profile.method === 'mpesa'
                                ? 'Phone number'
                                : 'Bank account',
                            profile.method === 'mpesa'
                                ? maskedPhone(profile.destination)
                                : maskedBankAccount(profile.destination),
                        ],
                        ['Submitted', dateTime(profile.createdAt)],
                        [
                            'Verification',
                            profile.verifiedAt
                                ? `Verified ${dateTime(profile.verifiedAt)}`
                                : 'Waiting for your operator',
                        ],
                    ].map(([label, value]) => (
                        <Box key={label} miw={0}>
                            <Text component='dt' size='xs' c='dimmed' mb={4}>
                                {label}
                            </Text>
                            <Text
                                component='dd'
                                m={0}
                                size='sm'
                                fw={500}
                                style={{ overflowWrap: 'anywhere' }}
                            >
                                {value}
                            </Text>
                        </Box>
                    ))}
                </SimpleGrid>
            </Box>
            <Divider />
            <Group
                p={{ base: 'md', sm: 'lg' }}
                justify='space-between'
                gap='md'
                align='center'
            >
                <Text size='xs' c='dimmed' style={{ flex: '1 1 260px' }}>
                    Changes require verification. Existing withdrawals keep
                    their original destination.
                </Text>
                <Button variant='default' onClick={onUpdate}>
                    Submit new destination
                </Button>
            </Group>
        </Paper>
    );
}

export function BalanceSummary({ balances }: { balances: Balance[] }) {
    if (!balances.length)
        return (
            <Paper withBorder p='md'>
                <Title order={3} size='h4'>
                    No commissions recorded yet
                </Title>
            </Paper>
        );
    return (
        <Stack gap='sm'>
            {balances.map((balance) => (
                <Paper
                    key={balance.currency}
                    withBorder
                    p='md'
                    className='balance-strip'
                >
                    <Group justify='space-between' mb='xs'>
                        <Title order={3} size='sm'>
                            {balance.currency} commissions
                        </Title>
                    </Group>
                    <SimpleGrid
                        cols={{ base: 2, md: 4 }}
                        spacing='sm'
                        className='balance-metrics'
                    >
                        {(
                            [
                                ['Available', balance.available, 'green'],
                                [
                                    'Reserved for withdrawal',
                                    balance.reserved,
                                    'orange',
                                ],
                                ['Recorded paid', balance.paid, 'blue'],
                                ['Total earned', balance.earned, 'violet'],
                            ] as const
                        ).map(([label, value, color]) => (
                            <div key={label} className='balance-metric'>
                                <Text c='dimmed' size='xs'>
                                    {label}
                                </Text>
                                <Text
                                    className='money'
                                    c={color}
                                    size='lg'
                                    mt={2}
                                >
                                    {money(value, balance.currency)}
                                </Text>
                            </div>
                        ))}
                    </SimpleGrid>
                </Paper>
            ))}
        </Stack>
    );
}

type WithdrawalDetail = { withdrawal: WithdrawalRow; events: AuditEvent[] };

function StatementDetails({
    row,
    detail,
}: {
    row: StatementRow;
    detail: WithdrawalDetail | null;
}) {
    const { source } = row;
    const rules: [string, string | null | undefined][] = source
        ? [
              [
                  'Commission basis',
                  source.basis === 'confirmed_collection_gross'
                      ? 'Confirmed gross collections'
                      : source.basis,
              ],
              [
                  'Agreement effective from',
                  source.agreementEffectiveFrom
                      ? dateTime(source.agreementEffectiveFrom)
                      : null,
              ],
              [
                  'Rounding',
                  source.rounding === 'half_up_minor_unit'
                      ? 'Rounded half up to the nearest currency minor unit'
                      : source.rounding,
              ],
              [
                  'Earned when',
                  source.entitlementRule === 'collection_recorded_at'
                      ? 'The collection is recorded'
                      : source.entitlementRule,
              ],
          ]
        : [];

    return (
        <Stack gap='md'>
            {source && (
                <>
                    <Title order={4} size='sm'>
                        Commission rules
                    </Title>
                    <RecordFields
                        columns={2}
                        fields={rules.filter(([, value]) => value != null)}
                    />
                </>
            )}
            {row.withdrawalId &&
                (detail?.withdrawal.id === row.withdrawalId ? (
                    <WithdrawalAuditContent
                        {...detail}
                        compact
                        entryId={row.id}
                    />
                ) : (
                    <Text role='status' size='sm'>
                        Loading withdrawal audit...
                    </Text>
                ))}
            {!row.withdrawalId && (
                <Text size='xs' c='dimmed' style={{ overflowWrap: 'anywhere' }}>
                    Entry: {row.id}
                </Text>
            )}
        </Stack>
    );
}

export function StatementView({
    data,
    paging,
    onWithdrawal,
    withdrawalDetail,
}: {
    data: Page<StatementRow>;
    paging: Paging;
    onWithdrawal: (id: string | null) => void;
    withdrawalDetail: WithdrawalDetail | null;
}) {
    const [expanded, setExpanded] = useState<string | null>(null);
    useEffect(() => setExpanded(null), [paging.page, paging.perPage]);
    function toggle(row: StatementRow) {
        const opening = expanded !== row.id;
        setExpanded(opening ? row.id : null);
        onWithdrawal(opening ? (row.withdrawalId ?? null) : null);
    }
    const kinds: Record<string, string> = {
        accrual: 'Commission earned',
        reserve: 'Withdrawal requested',
        release: 'Withdrawal funds returned',
        paid: 'Withdrawal paid',
    };
    return (
        <Stack>
            <div>
                <Title order={3} size='h4'>
                    Earnings & withdrawals
                </Title>
                <Text size='sm' c='dimmed' mt={4}>
                    Requests reserve funds; payments settle those reservations.
                    These are movements, not separate charges.
                </Text>
            </div>
            <LedgerTable
                label='Statement entries'
                headers={[
                    '#',
                    'Date',
                    'Movement',
                    'Amount',
                    'Collection basis',
                    'Details',
                ]}
                total={data.total}
                {...paging}
            >
                {data.items.map((row, index) => (
                    <Fragment key={row.id}>
                        <Table.Tr
                            className='statement-row'
                            onClick={() => toggle(row)}
                            data-expanded={expanded === row.id || undefined}
                        >
                            <Table.Td>
                                {(paging.page - 1) * paging.perPage + index + 1}
                            </Table.Td>
                            <Table.Td style={{ whiteSpace: 'nowrap' }}>
                                {dateTime(row.createdAt)}
                            </Table.Td>
                            <Table.Td>
                                <Badge
                                    variant='light'
                                    color={
                                        row.kind === 'accrual'
                                            ? 'blue'
                                            : row.kind === 'paid'
                                              ? 'green'
                                              : 'gray'
                                    }
                                >
                                    {kinds[row.kind] || row.kind}
                                </Badge>
                            </Table.Td>
                            <Table.Td
                                className={`money ${row.kind === 'accrual' ? 'statement-credit' : ''}`}
                                style={{ whiteSpace: 'nowrap' }}
                            >
                                {money(row.amount, row.currency)}
                            </Table.Td>
                            <Table.Td>
                                {row.source ? (
                                    <Stack gap={2}>
                                        <Text size='sm'>
                                            {money(
                                                row.source.collectionAmount,
                                                row.currency,
                                            )}{' '}
                                            at{' '}
                                            {Math.trunc(
                                                row.source.rateBps / 100,
                                            )}
                                            .
                                            {String(
                                                row.source.rateBps % 100,
                                            ).padStart(2, '0')}
                                            %
                                        </Text>
                                        <Text size='xs' c='dimmed'>
                                            {row.source.scopeType === 'nas'
                                                ? 'NAS'
                                                : 'PPPoE service account'}
                                            ; confirmed{' '}
                                            {dateTime(
                                                row.source.collectionRecordedAt,
                                            )}
                                        </Text>
                                    </Stack>
                                ) : (
                                    <Text c='dimmed' size='sm'>
                                        {row.kind === 'reserve'
                                            ? 'Available balance reserved'
                                            : row.kind === 'release'
                                              ? 'Returned to available balance'
                                              : 'Paid from reserved balance'}
                                    </Text>
                                )}
                            </Table.Td>
                            <Table.Td>
                                <Button
                                    variant='subtle'
                                    size='xs'
                                    aria-expanded={expanded === row.id}
                                    aria-controls={`statement-details-${row.id}`}
                                    aria-label={`${expanded === row.id ? 'Hide' : 'View'} details for statement ${row.id}`}
                                    rightSection={
                                        expanded === row.id ? (
                                            <MdExpandLess />
                                        ) : (
                                            <MdExpandMore />
                                        )
                                    }
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        toggle(row);
                                    }}
                                >
                                    {expanded === row.id
                                        ? 'Hide details'
                                        : 'View details'}
                                </Button>
                            </Table.Td>
                        </Table.Tr>
                        {expanded === row.id && (
                            <Table.Tr className='statement-expanded-row'>
                                <Table.Td colSpan={6}>
                                    <Stack
                                        id={`statement-details-${row.id}`}
                                        role='region'
                                        aria-label={`Details for statement ${row.id}`}
                                        p='md'
                                    >
                                        <StatementDetails
                                            row={row}
                                            detail={withdrawalDetail}
                                        />
                                    </Stack>
                                </Table.Td>
                            </Table.Tr>
                        )}
                    </Fragment>
                ))}
            </LedgerTable>
        </Stack>
    );
}

export function AgreementsView({
    data,
    paging,
}: {
    data: Page<AgreementRow>;
    paging: Paging;
}) {
    return (
        <Stack>
            <LedgerTable
                label='Agreements'
                headers={[
                    '#',
                    'Scope',
                    'Rate',
                    'Basis',
                    'Effective from',
                    'Effective to',
                    'Status',
                    'How it applies',
                    'Details',
                ]}
                total={data.total}
                {...paging}
            >
                {data.items.map((row, index) => {
                    const scheduled =
                        new Date(row.effectiveFrom).getTime() > Date.now();
                    const status = !row.isCurrent
                        ? scheduled
                            ? 'Scheduled'
                            : 'Overridden'
                        : row.rateBps === 0
                          ? 'Stopped'
                          : row.scopeType === 'nas'
                            ? 'NAS default'
                            : 'Account override';
                    const explanation = !row.isCurrent
                        ? scheduled
                            ? 'Starts at the effective date.'
                            : 'Replaced by a newer effective agreement for the same scope. This rate no longer applies to new collections.'
                        : row.scopeType === 'nas'
                          ? row.rateBps === 0
                              ? 'No NAS commission. PPPoE account overrides still take precedence.'
                              : 'Applies unless a PPPoE account agreement overrides it, including a 0% override.'
                          : 'Overrides the NAS rate for this PPPoE account, including when set to 0%.';
                    return (
                        <ExpandableTableRow
                            key={`${paging.page}:${paging.perPage}:${row.id}`}
                            id={`agreement-${row.id}`}
                            title='Commission agreement details'
                            colSpan={9}
                            details={
                                <RecordFields
                                    columns={2}
                                    fields={[
                                        [
                                            'Rate',
                                            `${(row.rateBps / 100).toFixed(2)}%`,
                                        ],
                                        ['Status', status],
                                        [
                                            'Effective from',
                                            dateTime(row.effectiveFrom),
                                        ],
                                        [
                                            'Effective to',
                                            row.effectiveTo
                                                ? dateTime(row.effectiveTo)
                                                : 'Present',
                                        ],
                                        [
                                            'Scope',
                                            row.scopeType === 'nas'
                                                ? 'NAS'
                                                : 'PPPoE service account',
                                        ],
                                        [
                                            'Basis',
                                            row.basis ===
                                            'confirmed_collection_gross'
                                                ? 'Confirmed gross collections'
                                                : row.basis,
                                        ],

                                        ['How this applies', explanation],
                                        ['Agreement reference', row.id],
                                    ]}
                                />
                            }
                        >
                            <Table.Td>
                                {(paging.page - 1) * paging.perPage + index + 1}
                            </Table.Td>
                            <Table.Td>
                                {row.scopeType === 'nas'
                                    ? 'NAS'
                                    : 'PPPoE service account'}
                            </Table.Td>
                            <Table.Td>
                                {Math.trunc(row.rateBps / 100)}.
                                {String(row.rateBps % 100).padStart(2, '0')}%
                            </Table.Td>
                            <Table.Td>
                                {row.basis === 'confirmed_collection_gross'
                                    ? 'Confirmed gross collections'
                                    : row.basis}
                            </Table.Td>
                            <Table.Td style={{ whiteSpace: 'nowrap' }}>
                                {dateTime(row.effectiveFrom)}
                            </Table.Td>
                            <Table.Td style={{ whiteSpace: 'nowrap' }}>
                                {row.effectiveTo
                                    ? dateTime(row.effectiveTo)
                                    : 'Present'}
                            </Table.Td>
                            <Table.Td>
                                <Tooltip
                                    label={explanation}
                                    multiline
                                    w={260}
                                    withArrow
                                    events={{
                                        hover: true,
                                        focus: true,
                                        touch: true,
                                    }}
                                >
                                    <Badge
                                        tabIndex={0}
                                        variant='light'
                                        color={
                                            scheduled || !row.isCurrent
                                                ? 'orange'
                                                : row.rateBps === 0
                                                  ? 'red'
                                                  : row.scopeType === 'nas'
                                                    ? 'blue'
                                                    : 'green'
                                        }
                                    >
                                        {status}
                                    </Badge>
                                </Tooltip>
                            </Table.Td>
                            <Table.Td
                                style={{
                                    whiteSpace: 'normal',
                                    minWidth: 260,
                                    maxWidth: 360,
                                }}
                            >
                                <Text size='sm'>{explanation}</Text>
                            </Table.Td>
                        </ExpandableTableRow>
                    );
                })}
            </LedgerTable>
        </Stack>
    );
}

export function WithdrawalsView({
    data,
    paging,
    onDetail,
    withdrawalDetail,
}: {
    data: Page<WithdrawalRow>;
    paging: Paging;
    onDetail: (id: string | null) => void;
    withdrawalDetail: WithdrawalDetail | null;
}) {
    const [expanded, setExpanded] = useState<string | null>(null);
    useEffect(() => setExpanded(null), [paging.page, paging.perPage]);
    return (
        <Stack>
            <div>
                <Text size='sm' c='dimmed'>
                    Payments are made manually by your operator.
                </Text>
            </div>
            <LedgerTable
                label='Withdrawals'
                headers={[
                    '#',
                    'Requested',
                    'Amount',
                    'Status',
                    'Destination',
                    'Updated',
                    'Reference',
                    'Details',
                ]}
                total={data.total}
                {...paging}
            >
                {data.items.map((row, index) => (
                    <ExpandableTableRow
                        key={`${paging.page}:${paging.perPage}:${row.id}`}
                        id={`withdrawal-${row.id}`}
                        title='Withdrawal details'
                        colSpan={8}
                        expanded={expanded === row.id}
                        onToggle={(opened) => {
                            setExpanded(opened ? row.id : null);
                            onDetail(opened ? row.id : null);
                        }}
                        details={
                            withdrawalDetail?.withdrawal.id === row.id ? (
                                <WithdrawalAuditContent
                                    {...withdrawalDetail}
                                    compact
                                />
                            ) : (
                                <Text size='sm' role='status'>
                                    Loading withdrawal audit...
                                </Text>
                            )
                        }
                    >
                        <Table.Td>
                            {(paging.page - 1) * paging.perPage + index + 1}
                        </Table.Td>
                        <Table.Td style={{ whiteSpace: 'nowrap' }}>
                            {dateTime(row.createdAt)}
                        </Table.Td>
                        <Table.Td
                            className='money'
                            style={{ whiteSpace: 'nowrap' }}
                        >
                            {money(row.amount, row.currency)}
                        </Table.Td>
                        <Table.Td>
                            <Badge
                                color={statusColor(row.status)}
                                variant='filled'
                            >
                                {row.status}
                            </Badge>
                        </Table.Td>
                        <Table.Td>
                            {row.payout
                                ? `${row.payout.method === 'mpesa' ? 'M-Pesa' : 'Bank'}: ${row.payout.method === 'mpesa' ? maskedPhone(row.payout.destination) : maskedBankAccount(row.payout.destination)}`
                                : 'Not recorded'}
                        </Table.Td>
                        <Table.Td>
                            {row.updatedAt
                                ? dateTime(row.updatedAt)
                                : 'Not recorded'}
                        </Table.Td>
                        <Table.Td>{row.reference || 'Not recorded'}</Table.Td>
                    </ExpandableTableRow>
                ))}
            </LedgerTable>
        </Stack>
    );
}
