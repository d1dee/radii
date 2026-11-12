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
import type { Balance, Page, PayoutProfile } from './api';
import { maskedPhone } from './lib/maskedPhone';
import {
    MdAccountBalance,
    MdCheckCircle,
    MdPhoneAndroid,
    MdSchedule,
    MdWallet,
} from 'react-icons/md';
import { LedgerTable } from './LedgerTable';
import { money } from './money';
import { RecordDetails } from './RecordDetails';

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
                    <Table.Tr key={event.id}>
                        <Table.Td>
                            {(paging.page - 1) * paging.perPage + index + 1}
                        </Table.Td>
                        <Table.Td>{dateTime(event.createdAt)}</Table.Td>
                        <Table.Td>{event.action.replaceAll('_', ' ')}</Table.Td>
                        <Table.Td>
                            {event.actorType === 'ADMIN' ? 'Operator' : 'Agent'}
                        </Table.Td>
                        <Table.Td>
                            <RecordDetails
                                title='Account activity details'
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
                        </Table.Td>
                    </Table.Tr>
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
                                : `Ending in ${profile.destination.slice(-4)}`,
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
                                ['Available', balance.available],
                                ['Reserved for withdrawal', balance.reserved],
                                ['Recorded paid', balance.paid],
                                ['Total earned', balance.earned],
                            ] as const
                        ).map(([label, value]) => (
                            <div key={label} className='balance-metric'>
                                <Text c='dimmed' size='xs'>
                                    {label}
                                </Text>
                                <Text
                                    className='money'
                                    fw={700}
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

export function StatementView({
    data,
    paging,
}: {
    data: Page<StatementRow>;
    paging: Paging;
}) {
    const kinds: Record<string, string> = {
        accrual: 'Commission earned',
        reserve: 'Reserved for withdrawal',
        release: 'Reservation released',
        paid: 'External payment recorded',
    };
    return (
        <Stack>
            <div>
                <Title order={3} size='h4'>
                    Commission statement
                </Title>
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
                    <Table.Tr key={row.id}>
                        <Table.Td>
                            {(paging.page - 1) * paging.perPage + index + 1}
                        </Table.Td>
                        <Table.Td style={{ whiteSpace: 'nowrap' }}>
                            {dateTime(row.createdAt)}
                        </Table.Td>
                        <Table.Td>{kinds[row.kind] || row.kind}</Table.Td>
                        <Table.Td
                            className='money'
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
                                        {Math.trunc(row.source.rateBps / 100)}.
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
                                    Not a collection entry
                                </Text>
                            )}
                        </Table.Td>
                        <Table.Td>
                            <RecordDetails
                                title={
                                    row.source
                                        ? 'Commission details'
                                        : 'Statement movement details'
                                }
                                fields={[
                                    ['Entry reference', row.id],
                                    ['Recorded', dateTime(row.createdAt)],
                                    ['Movement', kinds[row.kind] || row.kind],
                                    ['Amount', money(row.amount, row.currency)],
                                    ['Withdrawal reference', row.withdrawalId],
                                    ...(row.source
                                        ? ([
                                              [
                                                  'Source',
                                                  row.source.scopeType === 'nas'
                                                      ? 'NAS'
                                                      : 'PPPoE service account',
                                              ],
                                              [
                                                  'Confirmed collection',
                                                  money(
                                                      row.source
                                                          .collectionAmount,
                                                      row.currency,
                                                  ),
                                              ],
                                              [
                                                  'Collection confirmed',
                                                  dateTime(
                                                      row.source
                                                          .collectionRecordedAt,
                                                  ),
                                              ],
                                              [
                                                  'Historical rate',
                                                  `${(row.source.rateBps / 100).toFixed(2)}%`,
                                              ],
                                              [
                                                  'Basis',
                                                  row.source.basis ===
                                                  'confirmed_collection_gross'
                                                      ? 'Confirmed gross collections'
                                                      : row.source.basis,
                                              ],
                                              [
                                                  'Agreement effective from',
                                                  row.source
                                                      .agreementEffectiveFrom
                                                      ? dateTime(
                                                            row.source
                                                                .agreementEffectiveFrom,
                                                        )
                                                      : undefined,
                                              ],
                                              [
                                                  'Rounding rule',
                                                  row.source.rounding ===
                                                  'half_up_minor_unit'
                                                      ? 'Rounded half up to the nearest currency minor unit'
                                                      : row.source.rounding,
                                              ],
                                              [
                                                  'Entitlement rule',
                                                  row.source.entitlementRule ===
                                                  'collection_recorded_at'
                                                      ? 'Commission earned when the collection is recorded'
                                                      : row.source
                                                            .entitlementRule,
                                              ],
                                          ] as [
                                              string,
                                              string | null | undefined,
                                          ][])
                                        : []),
                                ]}
                            />
                        </Table.Td>
                    </Table.Tr>
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
                    'Status',
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
                            : 'Superseded'
                        : row.rateBps === 0
                          ? 'Stopped'
                          : row.scopeType === 'nas'
                            ? 'NAS default'
                            : 'Account override';
                    const explanation = !row.isCurrent
                        ? scheduled
                            ? 'Starts at the effective date.'
                            : 'Replaced by a newer agreement for the same scope.'
                        : row.scopeType === 'nas'
                          ? row.rateBps === 0
                              ? 'No NAS commission. PPPoE account overrides still take precedence.'
                              : 'Applies unless a PPPoE account agreement overrides it, including a 0% override.'
                          : 'Overrides the NAS rate for this PPPoE account, including when set to 0%.';
                    return (
                        <Table.Tr key={row.id}>
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
                                            scheduled
                                                ? 'orange'
                                                : !row.isCurrent ||
                                                    row.rateBps === 0
                                                  ? 'gray'
                                                  : row.scopeType === 'nas'
                                                    ? 'blue'
                                                    : 'green'
                                        }
                                    >
                                        {status}
                                    </Badge>
                                </Tooltip>
                            </Table.Td>
                            <Table.Td>
                                <RecordDetails
                                    title='Commission agreement details'
                                    fields={[
                                        ['Agreement reference', row.id],
                                        [
                                            'Scope',
                                            row.scopeType === 'nas'
                                                ? 'NAS'
                                                : 'PPPoE service account',
                                        ],
                                        [
                                            'Rate',
                                            `${(row.rateBps / 100).toFixed(2)}%`,
                                        ],
                                        [
                                            'Basis',
                                            row.basis ===
                                            'confirmed_collection_gross'
                                                ? 'Confirmed gross collections'
                                                : row.basis,
                                        ],
                                        [
                                            'Effective from',
                                            dateTime(row.effectiveFrom),
                                        ],
                                        [
                                            'Recorded',
                                            row.createdAt
                                                ? dateTime(row.createdAt)
                                                : undefined,
                                        ],
                                        ['Status', status],
                                        ['How this applies', explanation],
                                    ]}
                                />
                            </Table.Td>
                        </Table.Tr>
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
}: {
    data: Page<WithdrawalRow>;
    paging: Paging;
    onDetail: (id: string) => void;
}) {
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
                    <Table.Tr key={row.id}>
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
                                ? `${row.payout.method === 'mpesa' ? 'M-Pesa' : 'Bank'}: ${row.payout.method === 'mpesa' ? maskedPhone(row.payout.destination) : `Ending in ${row.payout.destination.slice(-4)}`}`
                                : 'Not recorded'}
                        </Table.Td>
                        <Table.Td>
                            {row.updatedAt
                                ? dateTime(row.updatedAt)
                                : 'Not recorded'}
                        </Table.Td>
                        <Table.Td>{row.reference || 'Not recorded'}</Table.Td>
                        <Table.Td>
                            <Button
                                size='xs'
                                variant='subtle'
                                onClick={() => onDetail(row.id)}
                            >
                                View details
                            </Button>
                        </Table.Td>
                    </Table.Tr>
                ))}
            </LedgerTable>
        </Stack>
    );
}
