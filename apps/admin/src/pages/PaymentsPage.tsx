import {
    Badge,
    Card,
    Center,
    Group,
    Loader,
    Pagination,
    Select,
    SimpleGrid,
    Stack,
    Table,
    Text,
    TextInput,
    Title,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { useDebouncedValue } from '@mantine/hooks';
import { useCallback, useEffect, useState } from 'react';
import { MdSearch } from 'react-icons/md';

import {
    getAdminPayments,
    type AdminPaymentList,
    type PackagePaymentStatus,
} from '@/lib/api';
import { useAutoRefresh } from '@/lib/autoRefresh';
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
            <Text size='xl' fw={700} mt={2}>
                {value}
            </Text>
        </Card>
    );
}

export default function PaymentsPage() {
    const { settings, loaded } = useAdminSettings();
    const perPage = settings.dashboard.perPage;
    const [data, setData] = useState<AdminPaymentList | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [status, setStatus] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [debouncedSearch] = useDebouncedValue(search, 300);
    const [from, setFrom] = useState<Date | null>(null);
    const [to, setTo] = useState<Date | null>(null);
    const [page, setPage] = useState(1);

    const load = useCallback(
        async (pageToLoad: number, silent = false) => {
            if (!silent) {
                setLoading(true);
                setError(null);
            }
            const res = await getAdminPayments({
                status: (status as PackagePaymentStatus) || undefined,
                q: debouncedSearch.trim() || undefined,
                from: from ? from.toISOString() : undefined,
                to: to ? dayjs(to).endOf('day').toISOString() : undefined,
                page: pageToLoad,
                perPage,
            });
            if (!silent) setLoading(false);
            if (!res.success) {
                if (!silent) setError(res.message || 'Failed to load payments');
                return;
            }
            if (!res.data) {
                if (!silent) setError('Failed to load payments');
                return;
            }
            setError(null);
            setData(res.data);
        },
        [status, debouncedSearch, from, to, perPage],
    );

    useEffect(() => {
        setPage(1);
    }, [status, debouncedSearch, from, to, perPage]);

    useEffect(() => {
        if (!loaded) return;
        void load(page);
    }, [loaded, load, page]);

    useAutoRefresh(() => void load(page, true), loaded);

    const totalPages = data ? Math.max(1, Math.ceil(data.total / perPage)) : 1;

    return (
        <>
            <Stack pb='md' gap={4}>
                <Title order={1}>Payment Log</Title>
                <Text size='sm' c='dimmed'>
                    Every package purchase across your NAS devices — filter by
                    status, customer or date range.
                </Text>
            </Stack>
            <Stack pb='md'>
                {data && (
                    <SimpleGrid cols={{ base: 2, lg: 4 }}>
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

                <Group wrap='wrap'>
                    <TextInput
                        placeholder='Search phone, name or receipt code'
                        leftSection={<MdSearch />}
                        value={search}
                        onChange={(e) => setSearch(e.currentTarget.value)}
                        style={{ flex: 1, minWidth: 220 }}
                    />
                    <Select
                        placeholder='Status'
                        clearable
                        value={status}
                        onChange={setStatus}
                        data={[
                            { value: 'paid', label: 'Paid' },
                            { value: 'pending', label: 'Pending' },
                            { value: 'failed', label: 'Failed' },
                        ]}
                        w={140}
                    />
                    <DateInput
                        placeholder='Date From'
                        value={from}
                        onChange={(v) => setFrom(v ? new Date(v) : null)}
                        clearable
                        w={150}
                    />
                    <DateInput
                        placeholder='Date To'
                        value={to}
                        onChange={(v) => setTo(v ? new Date(v) : null)}
                        clearable
                        w={150}
                    />
                </Group>
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
                    <Table.ScrollContainer minWidth='md' pb='md'>
                        <Table withRowBorders highlightOnHover>
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th>#</Table.Th>
                                    <Table.Th>Date</Table.Th>
                                    <Table.Th>Customer</Table.Th>
                                    <Table.Th>Package</Table.Th>
                                    <Table.Th>Amount</Table.Th>
                                    <Table.Th>Status</Table.Th>
                                    <Table.Th>Provider ref</Table.Th>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {data.payments.map((p, i) => (
                                    <Table.Tr key={p.id}>
                                        <Table.Td>{i + 1} </Table.Td>{' '}
                                        <Table.Td>
                                            <Text size='sm'>
                                                {formatDateTime(p.createdAt)}
                                            </Text>
                                        </Table.Td>
                                        <Table.Td>
                                            <Text size='sm' fw={500}>
                                                {p.userName ?? '—'}
                                            </Text>
                                            <Text size='xs' c='dimmed'>
                                                {p.phoneNumber}
                                            </Text>
                                        </Table.Td>
                                        <Table.Td>
                                            <Text size='sm'>
                                                {p.packageTitle ?? '—'}
                                            </Text>
                                            <Text size='xs' c='dimmed'>
                                                {p.packageType ?? ''}
                                            </Text>
                                        </Table.Td>
                                        <Table.Td>
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
                                            <Text size='xs' c='dimmed'>
                                                {p.providerTransactionId ?? '—'}
                                                {p.provider
                                                    ? ` (${p.provider})`
                                                    : ''}
                                            </Text>
                                        </Table.Td>
                                    </Table.Tr>
                                ))}
                            </Table.Tbody>
                        </Table>
                    </Table.ScrollContainer>
                </>
            )}
            {totalPages > 1 && (
                <Group justify='center' style={{ flexShrink: 0 }}>
                    <Pagination
                        value={page}
                        onChange={setPage}
                        total={totalPages}
                    />
                </Group>
            )}
        </>
    );
}
