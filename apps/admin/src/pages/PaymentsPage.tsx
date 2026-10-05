import {
    ActionIcon,
    Badge,
    Card,
    Center,
    Loader,
    Select,
    SimpleGrid,
    Stack,
    Table,
    Text,
    TextInput,
    Title,
    UnstyledButton,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useDebouncedValue } from '@mantine/hooks';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MdClose, MdSearch } from 'react-icons/md';
import { useSearchParams } from 'react-router-dom';

import { PageLayout } from '@/components/Layout/PageLayout';
import { PageTableScrollContainer } from '@/components/PageTableScrollContainer';
import { PaymentDetailsDrawer } from '@/components/Payments/PaymentDetailsDrawer';
import { PaymentRefCell } from '@/components/Payments/PaymentRefCell';
import {
    SortableTableHeader,
    type SortDirection,
} from '@/components/SortableTableHeader';
import { TablePagination } from '@/components/TablePagination';
import { TableFilters } from '@/components/TableFilters';
import {
    getAdminPayments,
    type AdminPaymentList,
    type PackagePaymentStatus,
    type PackageType,
    type PaymentSortKey,
} from '@/lib/api';
import { useAutoRefresh } from '@/lib/autoRefresh';
import { warnBackgroundFailure } from '@/lib/clientError';
import { dayjs } from '@/lib/dayjs';
import { formatDateTime, formatMoney } from '@/lib/format';
import { useAdminSettings } from '@/lib/settings';

const STATUS_BADGE: Record<
    PackagePaymentStatus,
    { color: string; label: string }
> = {
    paid: { color: 'green', label: 'Paid' },
    pending: { color: 'orange', label: 'Pending' },
    failed: { color: 'red', label: 'Failed' },
};

function SummaryCard({ label, value }: { label: string; value: string }) {
    return (
        <Card withBorder padding='md' radius='md'>
            <Text size='xs' c='dimmed'>
                {label}
            </Text>
            <Text
                size='lg'
                fw={700}
                mt={2}
                style={{ overflowWrap: 'anywhere' }}
            >
                {value}
            </Text>
        </Card>
    );
}

export default function PaymentsPage() {
    // Deep links (e.g. "View payments" from a PPPoE account card) filter the
    // log to one account via /payments?pppoeAccountId=<id>.
    const [searchParams, setSearchParams] = useSearchParams();
    const pppoeAccountId = searchParams.get('pppoeAccountId') ?? undefined;
    const clearPppoeFilter = () => {
        const next = new URLSearchParams(searchParams);
        next.delete('pppoeAccountId');
        setSearchParams(next, { replace: true });
    };
    const { settings, loaded } = useAdminSettings();
    const perPage = settings.dashboard.perPage;
    const [data, setData] = useState<AdminPaymentList | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [detailsId, setDetailsId] = useState<string | null>(null);

    const [status, setStatus] = useState<string | null>(null);
    const [packageType, setPackageType] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [debouncedSearch] = useDebouncedValue(search, 300);
    const [from, setFrom] = useState<Date | null>(null);
    const [to, setTo] = useState<Date | null>(null);
    const [dateRange, setDateRange] = useState<[string | null, string | null]>([
        null,
        null,
    ]);
    const [page, setPage] = useState(1);
    const [sortBy, setSortBy] = useState<PaymentSortKey>('createdAt');
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
    const loadRequest = useRef(0);

    const load = useCallback(
        async (pageToLoad: number, silent = false) => {
            const requestId = ++loadRequest.current;
            if (!silent) {
                setLoading(true);
                setError(null);
            }
            const res = await getAdminPayments({
                status: (status as PackagePaymentStatus) || undefined,
                type: (packageType as PackageType) || undefined,
                q: debouncedSearch.trim() || undefined,
                pppoeAccountId,
                from: from ? from.toISOString() : undefined,
                to: to ? dayjs(to).endOf('day').toISOString() : undefined,
                sortBy,
                sortDirection,
                page: pageToLoad,
                perPage,
            });
            if (requestId !== loadRequest.current) return;
            if (!silent) setLoading(false);
            if (!res.success) {
                if (silent) warnBackgroundFailure('refresh payments', res);
                else setError(res.message || 'Failed to load payments');
                return;
            }
            if (!res.data) {
                if (silent) warnBackgroundFailure('refresh payments', res);
                else setError('Failed to load payments');
                return;
            }
            setError(null);
            setData(res.data);
        },
        [
            status,
            packageType,
            debouncedSearch,
            pppoeAccountId,
            from,
            to,
            sortBy,
            sortDirection,
            perPage,
        ],
    );

    useEffect(() => {
        setPage(1);
    }, [
        status,
        packageType,
        debouncedSearch,
        pppoeAccountId,
        from,
        to,
        sortBy,
        sortDirection,
        perPage,
    ]);

    const handleSort = (key: PaymentSortKey, direction: SortDirection) => {
        setSortBy(key);
        setSortDirection(direction);
    };

    useEffect(() => {
        if (!loaded) return;
        void load(page);
    }, [loaded, load, page]);

    useAutoRefresh(() => void load(page, true), loaded);

    return (
        <PageLayout
            label='Payments page content'
            header={
                <Stack gap={4}>
                    <Title order={3}>Payments</Title>
                    <Text size='sm' c='dimmed'>
                        Every package purchase across your NAS devices — filter
                        by status, customer, NAS or date range.
                    </Text>
                </Stack>
            }
        >
            <Stack pb='md'>
                {data && (
                    <SimpleGrid cols={{ base: 4 }}>
                        <SummaryCard
                            label='Revenue (filtered)'
                            value={formatMoney(data.summary.revenue)}
                        />
                        <SummaryCard
                            label='Paid'
                            value={String(data.summary.paid)}
                        />
                        <SummaryCard
                            label='Pending'
                            value={String(data.summary.pending)}
                        />
                        <SummaryCard
                            label='Failed'
                            value={String(data.summary.failed)}
                        />
                    </SimpleGrid>
                )}

                <TableFilters
                    search={
                        <TextInput
                            aria-label='Search payments'
                            placeholder='Search phone, name, package, NAS or receipt code'
                            leftSection={<MdSearch />}
                            value={search}
                            onChange={(e) => setSearch(e.currentTarget.value)}
                            w={{ base: '100%', sm: 'auto' }}
                            style={{ flex: '1 1 220px', minWidth: 0 }}
                        />
                    }
                >
                    <Select
                        aria-label='Filter payments by status'
                        placeholder='Status'
                        clearable
                        value={status}
                        onChange={setStatus}
                        data={[
                            { value: 'paid', label: 'Paid' },
                            { value: 'pending', label: 'Pending' },
                            { value: 'failed', label: 'Failed' },
                        ]}
                        w={{ base: '100%', sm: 140 }}
                    />
                    <Select
                        aria-label='Filter payments by package type'
                        placeholder='Package type'
                        clearable
                        value={packageType}
                        onChange={setPackageType}
                        data={[
                            { value: 'hotspot', label: 'Hotspot' },
                            { value: 'pppoe', label: 'PPPoE' },
                        ]}
                        w={{ base: '100%', sm: 150 }}
                    />
                    {pppoeAccountId && (
                        <Badge
                            variant='light'
                            color='blue'
                            size='lg'
                            rightSection={
                                <ActionIcon
                                    size='xs'
                                    variant='transparent'
                                    aria-label='Clear PPPoE account filter'
                                    onClick={clearPppoeFilter}
                                >
                                    <MdClose size={14} />
                                </ActionIcon>
                            }
                        >
                            PPPoE account
                        </Badge>
                    )}
                    <DatePickerInput
                        type='range'
                        allowSingleDateInRange
                        aria-label='Payments date range'
                        placeholder='Date range'
                        value={dateRange}
                        onChange={(range) => {
                            setDateRange(range);
                            if (range[0] && range[1]) {
                                setFrom(
                                    dayjs(range[0]).startOf('day').toDate(),
                                );
                                setTo(dayjs(range[1]).endOf('day').toDate());
                            } else if (!range[0] && !range[1]) {
                                setFrom(null);
                                setTo(null);
                            }
                        }}
                        valueFormat='DD MMM YYYY'
                        clearable
                        clearButtonProps={{
                            'aria-label': 'Clear payments date range',
                        }}
                        w={{ base: '100%', sm: 300 }}
                    />
                </TableFilters>
            </Stack>
            {loading ? (
                <Center py='xl'>
                    <Loader />
                </Center>
            ) : error ? (
                <Text c='red'>{error}</Text>
            ) : !data || data.payments.length === 0 ? (
                <Text c='dimmed' py='xl' ta='center'>
                    No payments match.
                </Text>
            ) : (
                <>
                    <PageTableScrollContainer
                        minWidth={1080}
                        aria-label='Payments table'
                    >
                        <Table withRowBorders highlightOnHover stickyHeader>
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th>#</Table.Th>
                                    <SortableTableHeader
                                        label='Date'
                                        sortKey='createdAt'
                                        sortBy={sortBy}
                                        sortDirection={sortDirection}
                                        onSort={handleSort}
                                        initialDirection='desc'
                                    />
                                    <SortableTableHeader
                                        label='Customer'
                                        width={240}
                                        sortKey='customer'
                                        sortBy={sortBy}
                                        sortDirection={sortDirection}
                                        onSort={handleSort}
                                    />
                                    <SortableTableHeader
                                        label='Package'
                                        width={220}
                                        sortKey='package'
                                        sortBy={sortBy}
                                        sortDirection={sortDirection}
                                        onSort={handleSort}
                                    />
                                    <Table.Th w={180}>NAS</Table.Th>
                                    <SortableTableHeader
                                        label='Amount'
                                        sortKey='amount'
                                        sortBy={sortBy}
                                        sortDirection={sortDirection}
                                        onSort={handleSort}
                                        initialDirection='desc'
                                    />
                                    <SortableTableHeader
                                        label='Status'
                                        width={100}
                                        sortKey='status'
                                        sortBy={sortBy}
                                        sortDirection={sortDirection}
                                        onSort={handleSort}
                                    />
                                    <Table.Th>Provider ref</Table.Th>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {data.payments.map((p, i) => (
                                    <Table.Tr
                                        key={p.id}
                                        onClick={() => setDetailsId(p.id)}
                                        style={{ cursor: 'pointer' }}
                                    >
                                        <Table.Td>
                                            {(page - 1) * perPage + i + 1}
                                        </Table.Td>
                                        <Table.Td>
                                            <Text size='sm'>
                                                {formatDateTime(p.createdAt)}
                                            </Text>
                                        </Table.Td>
                                        <Table.Td className='admin-table-identity'>
                                            <UnstyledButton
                                                fz='sm'
                                                fw={500}
                                                aria-label={`View payment details for ${p.userName || p.phoneNumber} on ${formatDateTime(p.createdAt)}`}
                                            >
                                                {p.userName ?? '—'}
                                            </UnstyledButton>
                                            <Text size='xs' c='dimmed'>
                                                {p.phoneNumber}
                                            </Text>
                                        </Table.Td>
                                        <Table.Td className='admin-table-identity'>
                                            <Text size='sm'>
                                                {p.packageTitle ?? '—'}
                                            </Text>
                                            <Text size='xs' c='dimmed'>
                                                {p.packageType ?? ''}
                                            </Text>
                                        </Table.Td>
                                        <Table.Td className='admin-table-identity'>
                                            <Text size='sm'>
                                                {p.nasDeviceName}
                                            </Text>
                                        </Table.Td>
                                        <Table.Td className='admin-table-value'>
                                            {formatMoney(p.amount)}
                                        </Table.Td>
                                        <Table.Td>
                                            <Badge
                                                size='sm'
                                                variant='light'
                                                color={
                                                    STATUS_BADGE[p.status]
                                                        ?.color ?? 'gray'
                                                }
                                            >
                                                {STATUS_BADGE[p.status]
                                                    ?.label ?? p.status}
                                            </Badge>
                                        </Table.Td>
                                        <Table.Td>
                                            <PaymentRefCell
                                                provider={p.provider}
                                                providerTransactionId={
                                                    p.providerTransactionId
                                                }
                                            />
                                        </Table.Td>
                                    </Table.Tr>
                                ))}
                            </Table.Tbody>
                        </Table>
                    </PageTableScrollContainer>
                </>
            )}
            {data ? (
                <TablePagination
                    page={page}
                    perPage={perPage}
                    total={data.total}
                    onChange={setPage}
                    loading={loading}
                />
            ) : null}
            <PaymentDetailsDrawer
                paymentId={detailsId}
                onClose={() => setDetailsId(null)}
            />
        </PageLayout>
    );
}
