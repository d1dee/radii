import { AreaChart, DonutChart } from '@mantine/charts';
import {
    Badge,
    Button,
    Card,
    Center,
    Grid,
    Group,
    Loader,
    SimpleGrid,
    Stack,
    Table,
    Text,
    Title,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { notifications } from '@mantine/notifications';
import { useCallback, useEffect, useRef, useState } from 'react';

import { PageLayout } from '@/components/Layout/PageLayout';
import { PageTableScrollContainer } from '@/components/PageTableScrollContainer';
import { TablePagination } from '@/components/TablePagination';
import { getAdminReports, type AdminReports } from '@/lib/api';
import { useAutoRefresh } from '@/lib/autoRefresh';
import { warnBackgroundFailure } from '@/lib/clientError';
import { dayjs } from '@/lib/dayjs';
import { formatBytes, formatMoney, formatSeconds } from '@/lib/format';
import { useAdminSettings } from '@/lib/settings';

function SummaryCard({
    label,
    value,
    sub,
}: {
    label: string;
    value: string;
    sub?: string;
}) {
    return (
        <Card withBorder padding='md' radius='md' miw={0}>
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
            {sub ? (
                <Text size='xs' c='dimmed' mt={2}>
                    {sub}
                </Text>
            ) : null}
        </Card>
    );
}

export default function ReportsPage() {
    const { settings, loaded } = useAdminSettings();
    const [reports, setReports] = useState<AdminReports | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [from, setFrom] = useState<Date>(
        dayjs().subtract(30, 'day').startOf('day').toDate(),
    );
    const [to, setTo] = useState<Date>(dayjs().endOf('day').toDate());
    const [dateRange, setDateRange] = useState<[string | null, string | null]>([
        dayjs(from).format('YYYY-MM-DD'),
        dayjs(to).format('YYYY-MM-DD'),
    ]);
    const [topPackagesPage, setTopPackagesPage] = useState(1);
    const [topUsersPage, setTopUsersPage] = useState(1);
    const [heavyUsersPage, setHeavyUsersPage] = useState(1);
    const perPage = settings.dashboard.perPage;
    const loadRequest = useRef(0);

    const load = useCallback(
        async (
            rangeFrom: Date,
            rangeTo: Date,
            pages = {
                topPackagesPage,
                topUsersPage,
                heavyUsersPage,
            },
            silent = false,
        ) => {
            const requestId = ++loadRequest.current;
            if (!silent) {
                setLoading(true);
                setError(null);
            }
            const res = await getAdminReports(
                rangeFrom.toISOString(),
                rangeTo.toISOString(),
                {
                    ...pages,
                    topPackagesPerPage: perPage,
                    topUsersPerPage: perPage,
                    heavyUsersPerPage: perPage,
                },
            );
            if (requestId !== loadRequest.current) return;
            if (!silent) setLoading(false);
            if (!res.success) {
                if (silent) warnBackgroundFailure('refresh reports', res);
                else setError(res.message || 'Failed to load reports');
                return;
            }
            if (!res.data) {
                if (silent) warnBackgroundFailure('refresh reports', res);
                else setError('Failed to load reports');
                return;
            }
            setError(null);
            setReports(res.data);
        },
        [topPackagesPage, topUsersPage, heavyUsersPage, perPage],
    );

    // Waits once for settings so the admin's default range applies to the
    // initial load; the Apply button drives the rest.
    useEffect(() => {
        if (!loaded) return;
        const rangeFrom = dayjs()
            .subtract(settings.dashboard.defaultRangeDays, 'day')
            .startOf('day')
            .toDate();
        const rangeTo = dayjs().endOf('day').toDate();
        setFrom(rangeFrom);
        setTo(rangeTo);
        setDateRange([
            dayjs(rangeFrom).format('YYYY-MM-DD'),
            dayjs(rangeTo).format('YYYY-MM-DD'),
        ]);
        void load(rangeFrom, rangeTo);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loaded]);

    // Keep the currently selected range up to date on the admin's cadence.
    const autoRefreshData = useCallback(() => {
        void load(from, to, undefined, true);
    }, [load, from, to]);
    useAutoRefresh(autoRefreshData, loaded);

    const apply = () => {
        if (!dateRange[0] || !dateRange[1]) return;
        const rangeFrom = dayjs(dateRange[0]).startOf('day').toDate();
        const rangeTo = dayjs(dateRange[1]).endOf('day').toDate();
        if (rangeFrom.getTime() > rangeTo.getTime()) {
            notifications.show({ color: 'red', message: 'Invalid date range' });
            return;
        }
        const firstPages = {
            topPackagesPage: 1,
            topUsersPage: 1,
            heavyUsersPage: 1,
        };
        setTopPackagesPage(1);
        setTopUsersPage(1);
        setHeavyUsersPage(1);
        setFrom(rangeFrom);
        setTo(rangeTo);
        void load(rangeFrom, rangeTo, firstPages);
    };

    useEffect(() => {
        if (!loaded || !reports) return;
        void load(from, to);
        // Each report pager reloads its requested ranked slice.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [topPackagesPage, topUsersPage, heavyUsersPage, perPage]);

    const statusBreakdown = reports
        ? [
              {
                  name: 'Paid',
                  value: reports.daily.reduce((sum, d) => sum + d.paid, 0),
                  color: 'teal.6',
              },
              {
                  name: 'Pending',
                  value: reports.daily.reduce((sum, d) => sum + d.pending, 0),
                  color: 'orange.6',
              },
              {
                  name: 'Failed',
                  value: reports.daily.reduce((sum, d) => sum + d.failed, 0),
                  color: 'red.6',
              },
          ]
        : [];

    return (
        <PageLayout
            label='Reports page content'
            header={
                <Group justify='space-between' wrap='wrap'>
                    <Stack gap={4}>
                        <Title order={3}>Reports</Title>
                        <Text size='sm' c='dimmed'>
                            Revenue, top packages, customers and heaviest
                            network consumers for a date range.
                        </Text>
                    </Stack>
                    <Group
                        gap='sm'
                        align='flex-end'
                        w={{ base: '100%', sm: 'auto' }}
                        wrap='nowrap'
                    >
                        <DatePickerInput
                            type='range'
                            allowSingleDateInRange
                            label='Date range'
                            placeholder='Select date range'
                            value={dateRange}
                            onChange={setDateRange}
                            valueFormat='DD MMM YYYY'
                            w='100%'
                        />
                        <Button
                            onClick={apply}
                            disabled={!dateRange[0] || !dateRange[1]}
                            w='200'
                        >
                            Apply
                        </Button>
                    </Group>
                </Group>
            }
        >
            {loading ? (
                <Center py='xl'>
                    <Loader />
                </Center>
            ) : error ? (
                <Text c='red'>{error}</Text>
            ) : !reports ? null : (
                <>
                    <SimpleGrid cols={{ base: 2, lg: 5 }} mb='md'>
                        <SummaryCard
                            label='Revenue'
                            value={formatMoney(reports.totals.revenue)}
                            sub={`${reports.totals.payments} payments`}
                        />
                        <SummaryCard
                            label='Buyers'
                            value={String(reports.totals.buyers)}
                        />
                        <SummaryCard
                            label='New users'
                            value={String(reports.totals.newUsers)}
                        />
                        <SummaryCard
                            label='New activations'
                            value={String(reports.totals.newActivations)}
                        />
                        <SummaryCard
                            label='Avg per buyer'
                            value={
                                reports.totals.buyers > 0
                                    ? formatMoney(
                                          reports.totals.revenue /
                                              reports.totals.buyers,
                                      )
                                    : '—'
                            }
                        />
                    </SimpleGrid>
                    <Stack gap='md' miw={0}>
                        <Grid>
                            <Grid.Col span={{ base: 12, lg: 8 }}>
                                <Card withBorder padding='md' h='100%'>
                                    <Text fw={600} mb='sm'>
                                        Daily revenue
                                    </Text>
                                    {reports.daily.length === 0 ? (
                                        <Text size='sm' c='dimmed'>
                                            No payments in this range.
                                        </Text>
                                    ) : (
                                        <AreaChart
                                            h={280}
                                            data={reports.daily}
                                            dataKey='day'
                                            series={[
                                                {
                                                    name: 'revenue',
                                                    color: 'teal.6',
                                                    label: 'Revenue',
                                                },
                                            ]}
                                            curveType='monotone'
                                            withDots={false}
                                            yAxisProps={{ width: 60 }}
                                        />
                                    )}
                                </Card>
                            </Grid.Col>
                            <Grid.Col span={{ base: 12, lg: 4 }}>
                                <Card withBorder padding='md' h='100%'>
                                    <Text fw={600} mb='sm'>
                                        Payments by status
                                    </Text>
                                    {statusBreakdown.every(
                                        (s) => s.value === 0,
                                    ) ? (
                                        <Text size='sm' c='dimmed'>
                                            No payments in this range.
                                        </Text>
                                    ) : (
                                        <Center>
                                            <DonutChart
                                                data={statusBreakdown}
                                                size={220}
                                                thickness={28}
                                                withLabelsLine={false}
                                                chartLabel={String(
                                                    statusBreakdown.reduce(
                                                        (sum, s) =>
                                                            sum + s.value,
                                                        0,
                                                    ),
                                                )}
                                            />
                                        </Center>
                                    )}
                                    <Group justify='center' gap='md' mt='sm'>
                                        {statusBreakdown.map((s) => (
                                            <Group key={s.name} gap={4}>
                                                <Badge
                                                    size='xs'
                                                    color={s.color}
                                                    variant='filled'
                                                >
                                                    {s.value}
                                                </Badge>
                                                <Text size='xs'>{s.name}</Text>
                                            </Group>
                                        ))}
                                    </Group>
                                </Card>
                            </Grid.Col>
                        </Grid>
                        <Grid>
                            <Grid.Col span={{ base: 12, lg: 6 }}>
                                <Card withBorder padding='md' h='100%'>
                                    <Text fw={600} mb='sm'>
                                        Top packages by revenue
                                    </Text>
                                    {reports.topPackages.items.length === 0 ? (
                                        <Text size='sm' c='dimmed'>
                                            No paid purchases in this range.
                                        </Text>
                                    ) : (
                                        <PageTableScrollContainer
                                            minWidth={560}
                                            aria-label='Top packages table'
                                        >
                                            <Table
                                                striped
                                                verticalSpacing='xs'
                                                stickyHeader
                                            >
                                                <Table.Thead>
                                                    <Table.Tr>
                                                        <Table.Th>#</Table.Th>
                                                        <Table.Th>
                                                            Package
                                                        </Table.Th>
                                                        <Table.Th>
                                                            Type
                                                        </Table.Th>
                                                        <Table.Th ta='right'>
                                                            Purchases
                                                        </Table.Th>
                                                        <Table.Th ta='right'>
                                                            Revenue
                                                        </Table.Th>
                                                    </Table.Tr>
                                                </Table.Thead>
                                                <Table.Tbody>
                                                    {reports.topPackages.items.map(
                                                        (p, i) => (
                                                            <Table.Tr
                                                                key={
                                                                    p.packageId
                                                                }
                                                            >
                                                                <Table.Td>
                                                                    {(topPackagesPage -
                                                                        1) *
                                                                        perPage +
                                                                        i +
                                                                        1}
                                                                </Table.Td>
                                                                <Table.Td>
                                                                    {p.title}
                                                                </Table.Td>
                                                                <Table.Td>
                                                                    <Badge
                                                                        size='sm'
                                                                        variant='light'
                                                                    >
                                                                        {p.type}
                                                                    </Badge>
                                                                </Table.Td>
                                                                <Table.Td ta='right'>
                                                                    {p.paid}
                                                                </Table.Td>
                                                                <Table.Td ta='right'>
                                                                    {formatMoney(
                                                                        p.revenue,
                                                                    )}
                                                                </Table.Td>
                                                            </Table.Tr>
                                                        ),
                                                    )}
                                                </Table.Tbody>
                                            </Table>
                                        </PageTableScrollContainer>
                                    )}
                                    <TablePagination
                                        page={topPackagesPage}
                                        perPage={perPage}
                                        total={reports.topPackages.total}
                                        onChange={setTopPackagesPage}
                                        loading={loading}
                                    />
                                </Card>
                            </Grid.Col>
                            <Grid.Col span={{ base: 12, lg: 6 }}>
                                <Card withBorder padding='md' h='100%'>
                                    <Text fw={600} mb='sm'>
                                        Top customers by spend
                                    </Text>
                                    {reports.topUsers.items.length === 0 ? (
                                        <Text size='sm' c='dimmed'>
                                            No paid purchases in this range.
                                        </Text>
                                    ) : (
                                        <PageTableScrollContainer
                                            minWidth={500}
                                            aria-label='Top customers table'
                                        >
                                            <Table
                                                striped
                                                verticalSpacing='xs'
                                                stickyHeader
                                            >
                                                <Table.Thead>
                                                    <Table.Tr>
                                                        <Table.Th>#</Table.Th>
                                                        <Table.Th>
                                                            Customer
                                                        </Table.Th>
                                                        <Table.Th ta='right'>
                                                            Purchases
                                                        </Table.Th>
                                                        <Table.Th ta='right'>
                                                            Spent
                                                        </Table.Th>
                                                    </Table.Tr>
                                                </Table.Thead>
                                                <Table.Tbody>
                                                    {reports.topUsers.items.map(
                                                        (u, i) => (
                                                            <Table.Tr
                                                                key={u.userId}
                                                            >
                                                                <Table.Td>
                                                                    {(topUsersPage -
                                                                        1) *
                                                                        perPage +
                                                                        i +
                                                                        1}
                                                                </Table.Td>
                                                                <Table.Td>
                                                                    <Text size='sm'>
                                                                        {
                                                                            u.userName
                                                                        }
                                                                    </Text>
                                                                    <Text
                                                                        size='xs'
                                                                        c='dimmed'
                                                                    >
                                                                        {
                                                                            u.phoneNumber
                                                                        }
                                                                    </Text>
                                                                </Table.Td>
                                                                <Table.Td ta='right'>
                                                                    {u.paid}
                                                                </Table.Td>
                                                                <Table.Td ta='right'>
                                                                    {formatMoney(
                                                                        u.revenue,
                                                                    )}
                                                                </Table.Td>
                                                            </Table.Tr>
                                                        ),
                                                    )}
                                                </Table.Tbody>
                                            </Table>
                                        </PageTableScrollContainer>
                                    )}
                                    <TablePagination
                                        page={topUsersPage}
                                        perPage={perPage}
                                        total={reports.topUsers.total}
                                        onChange={setTopUsersPage}
                                        loading={loading}
                                    />
                                </Card>
                            </Grid.Col>
                            <Grid.Col span={12}>
                                <Card withBorder padding='md'>
                                    <Text fw={600} mb='sm'>
                                        Heaviest consumers (RADIUS accounting)
                                    </Text>
                                    {reports.heavyUsers.items.length === 0 ? (
                                        <Text size='sm' c='dimmed'>
                                            No sessions in this range.
                                        </Text>
                                    ) : (
                                        <PageTableScrollContainer
                                            minWidth={640}
                                            aria-label='Heaviest consumers table'
                                        >
                                            <Table
                                                striped
                                                verticalSpacing='xs'
                                                stickyHeader
                                            >
                                                <Table.Thead>
                                                    <Table.Tr>
                                                        <Table.Th>#</Table.Th>
                                                        <Table.Th>
                                                            RADIUS user
                                                        </Table.Th>
                                                        <Table.Th ta='right'>
                                                            Sessions
                                                        </Table.Th>
                                                        <Table.Th ta='right'>
                                                            Time online
                                                        </Table.Th>
                                                        <Table.Th ta='right'>
                                                            Data
                                                        </Table.Th>
                                                    </Table.Tr>
                                                </Table.Thead>
                                                <Table.Tbody>
                                                    {reports.heavyUsers.items.map(
                                                        (u, i) => (
                                                            <Table.Tr
                                                                key={u.username}
                                                            >
                                                                <Table.Td>
                                                                    {(heavyUsersPage -
                                                                        1) *
                                                                        perPage +
                                                                        i +
                                                                        1}
                                                                </Table.Td>
                                                                <Table.Td>
                                                                    {u.username ||
                                                                        '—'}
                                                                </Table.Td>
                                                                <Table.Td ta='right'>
                                                                    {u.sessions}
                                                                </Table.Td>
                                                                <Table.Td ta='right'>
                                                                    {formatSeconds(
                                                                        u.seconds,
                                                                    )}
                                                                </Table.Td>
                                                                <Table.Td ta='right'>
                                                                    {formatBytes(
                                                                        u.octets,
                                                                    )}
                                                                </Table.Td>
                                                            </Table.Tr>
                                                        ),
                                                    )}
                                                </Table.Tbody>
                                            </Table>
                                        </PageTableScrollContainer>
                                    )}
                                    <TablePagination
                                        page={heavyUsersPage}
                                        perPage={perPage}
                                        total={reports.heavyUsers.total}
                                        onChange={setHeavyUsersPage}
                                        loading={loading}
                                    />
                                </Card>
                            </Grid.Col>
                        </Grid>
                    </Stack>
                </>
            )}
        </PageLayout>
    );
}
