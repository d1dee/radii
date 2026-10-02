import { AreaChart, BarChart, DonutChart } from '@mantine/charts';
import {
    ActionIcon,
    Badge,
    Card,
    Center,
    Grid,
    Group,
    Loader,
    SegmentedControl,
    SimpleGrid,
    Skeleton,
    Stack,
    Table,
    Text,
    Title,
    Tooltip,
} from '@mantine/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MdRefresh } from 'react-icons/md';

import { TablePagination } from '@/components/TablePagination';
import {
    getAdminReports,
    getRadiusSummary,
    type AdminReports,
    type NetworkUsage,
} from '@/lib/api';
import { useAutoRefresh } from '@/lib/autoRefresh';
import { warnBackgroundFailure } from '@/lib/clientError';
import { dayjs } from '@/lib/dayjs';
import { formatBytes, formatMoney, formatSpeed } from '@/lib/format';
import { useAdminSettings } from '@/lib/settings';

const rangePresets = [
    { label: 'Today', days: 0 },
    { label: '7d', days: 7 },
    { label: '30d', days: 30 },
    { label: '90d', days: 90 },
];

function presetRange(days: number): { from: Date; to: Date } {
    return {
        from:
            days === 0
                ? dayjs().startOf('day').toDate()
                : dayjs()
                      .subtract(days - 1, 'day')
                      .startOf('day')
                      .toDate(),
        to: dayjs().endOf('day').toDate(),
    };
}

function StatCard({
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

export default function DashboardPage() {
    const { settings, loaded } = useAdminSettings();
    const [reports, setReports] = useState<AdminReports | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [usage, setUsage] = useState<NetworkUsage | null>(null);
    const [preset, setPreset] = useState('30d');
    const [from, setFrom] = useState<Date>(() => presetRange(30).from);
    const [to, setTo] = useState<Date>(() => presetRange(30).to);

    const [topUsersPage, setTopUsersPage] = useState(1);
    const topUsersPerPage = 6;
    const reportsRequest = useRef(0);

    const loadReports = useCallback(
        async (rangeFrom: Date, rangeTo: Date, silent = false) => {
            const requestId = ++reportsRequest.current;
            if (!silent) setLoading(true);
            setError(null);
            const res = await getAdminReports(
                rangeFrom.toISOString(),
                rangeTo.toISOString(),
                {
                    topPackagesPerPage: 10,
                    topUsersPage,
                    topUsersPerPage,
                    heavyUsersPerPage: 10,
                },
            );
            if (requestId !== reportsRequest.current) return;
            if (!silent) setLoading(false);
            if (!res.success) {
                if (silent)
                    warnBackgroundFailure('refresh dashboard reports', res);
                else setError(res.message || 'Failed to load dashboard data');
                return;
            }
            if (!res.data) {
                if (silent)
                    warnBackgroundFailure('refresh dashboard reports', res);
                else setError('Failed to load dashboard data');
                return;
            }
            setReports(res.data);
        },
        [topUsersPage],
    );

    const loadUsage = useCallback(async () => {
        const res = await getRadiusSummary(60);
        if (res.success && res.data) setUsage(res.data);
        else warnBackgroundFailure('load dashboard network usage', res);
    }, []);

    // Initial load waits for the admin's saved settings so their default
    // date range applies; presets/Apply drive the rest.
    const initialLoadDone = useRef(false);
    useEffect(() => {
        if (!loaded || initialLoadDone.current) return;
        initialLoadDone.current = true;
        const days = settings.dashboard.defaultRangeDays;
        setPreset(rangePresets.find((p) => p.days === days)?.label ?? '30d');
        const range = presetRange(days);
        setFrom(range.from);
        setTo(range.to);

        void loadReports(range.from, range.to);
    }, [loaded, settings, loadReports]);

    // Live network figures and the current report range refresh together on
    // the admin's configured cadence.
    useEffect(() => {
        void loadUsage();
    }, [loadUsage]);

    const autoRefreshData = useCallback(() => {
        void loadUsage();
        void loadReports(from, to, true);
    }, [loadUsage, loadReports, from, to]);
    useAutoRefresh(autoRefreshData);

    useEffect(() => {
        if (!loaded || !reports) return;
        void loadReports(from, to);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [topUsersPage]);

    const applyPreset = (label: string) => {
        setTopUsersPage(1);
        setPreset(label);
        const found = rangePresets.find((p) => p.label === label);
        if (!found) return;
        const range = presetRange(found.days);
        setFrom(range.from);
        setTo(range.to);

        void loadReports(range.from, range.to);
    };

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

    const packageChartData = (reports?.topPackages.items ?? []).map((p) => ({
        package: p.title,
        revenue: p.revenue,
        paid: p.paid,
    }));

    return (
        <Stack gap='md' miw={0}>
            <Group justify='space-between' wrap='wrap'>
                <Stack gap={4}>
                    <Title order={3}>Dashboard</Title>
                    <Text size='sm' c='dimmed'>
                        Live network activity and revenue overview for the
                        selected date range.
                    </Text>
                </Stack>
                <Group
                    gap='sm'
                    align='flex-end'
                    w={{ base: '100%', md: 'auto' }}
                >
                    <SegmentedControl
                        aria-label='Date range preset'
                        w={{ base: '100%', sm: 'auto' }}
                        value={preset}
                        onChange={applyPreset}
                        data={rangePresets.map((p) => p.label)}
                    />
                </Group>
            </Group>

            {/* Live network right now */}
            <Card withBorder padding='md' radius='md'>
                <Group justify='space-between' mb='xs'>
                    <Group gap='xs'>
                        <Badge color='green' variant='dot' size='lg'>
                            Live network
                        </Badge>
                        <Text size='xs' c='dimmed'>
                            last 60 minutes, refreshes every minute
                        </Text>
                    </Group>
                    <Tooltip label='Refresh now'>
                        <ActionIcon
                            aria-label='Refresh live network'
                            size='lg'
                            variant='subtle'
                            onClick={() => void loadUsage()}
                        >
                            <MdRefresh size={18} />
                        </ActionIcon>
                    </Tooltip>
                </Group>
                {!usage ? (
                    <SimpleGrid cols={{ base: 2, lg: 5 }}>
                        {Array.from({ length: 5 }).map((_, i) => (
                            <Skeleton key={i} height={48} radius='sm' />
                        ))}
                    </SimpleGrid>
                ) : (
                    <SimpleGrid cols={{ base: 2, lg: 5 }}>
                        <StatCard
                            label='Online sessions'
                            value={String(usage.liveSessions)}
                            sub={`${usage.sessionsStartedInWindow} started in last hour`}
                        />
                        <StatCard
                            label='Online users'
                            value={String(usage.liveUsers)}
                        />
                        <StatCard
                            label='Throughput'
                            value={formatSpeed(usage.aggregateThroughputBps)}
                            sub={`avg ${formatSpeed(usage.avgSpeedPerSessionBps)}/session`}
                        />
                        <StatCard
                            label='Data in window'
                            value={formatBytes(usage.liveOctets)}
                        />
                        <StatCard
                            label='Avg session time'
                            value={
                                usage.avgSessionSeconds > 0
                                    ? `${Math.round(usage.avgSessionSeconds / 60)}m`
                                    : '—'
                            }
                        />
                    </SimpleGrid>
                )}
            </Card>

            {error ? (
                <Text c='red'>{error}</Text>
            ) : loading ? (
                <Center py='xl'>
                    <Loader />
                </Center>
            ) : !reports ? null : (
                <>
                    <SimpleGrid cols={{ base: 2, lg: 5 }}>
                        <StatCard
                            label='Revenue'
                            value={formatMoney(reports.totals.revenue)}
                            sub={`${reports.totals.payments} payments`}
                        />
                        <StatCard
                            label='Buyers'
                            value={String(reports.totals.buyers)}
                        />
                        <StatCard
                            label='New users'
                            value={String(reports.totals.newUsers)}
                        />
                        <StatCard
                            label='New activations'
                            value={String(reports.totals.newActivations)}
                        />
                        <StatCard
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
                                {statusBreakdown.every((s) => s.value === 0) ? (
                                    <Text size='sm' c='dimmed'>
                                        No payments in this range.
                                    </Text>
                                ) : (
                                    <Center>
                                        <DonutChart
                                            data={statusBreakdown}
                                            size={220}
                                            thickness={24}
                                            withLabelsLine={false}
                                            chartLabel={String(
                                                statusBreakdown.reduce(
                                                    (sum, s) => sum + s.value,
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
                        <Grid.Col span={{ base: 12, lg: 6 }}>
                            <Card withBorder padding='md' h='100%'>
                                <Text fw={600} mb='sm'>
                                    Top packages by revenue
                                </Text>
                                {packageChartData.length === 0 ? (
                                    <Text size='sm' c='dimmed'>
                                        No paid purchases in this range.
                                    </Text>
                                ) : (
                                    <BarChart
                                        h={260}
                                        data={packageChartData}
                                        dataKey='package'
                                        series={[
                                            {
                                                name: 'revenue',
                                                color: 'blue.6',
                                                label: 'Revenue',
                                            },
                                        ]}
                                        yAxisProps={{ width: 60 }}
                                        mb='xs'
                                    />
                                )}
                            </Card>
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, lg: 6 }}>
                            <Card withBorder padding='md' h='100%'>
                                <Text fw={600} mb='sm'>
                                    Top customers
                                </Text>
                                {reports.topUsers.items.length === 0 ? (
                                    <Text size='sm' c='dimmed'>
                                        No paid purchases in this range.
                                    </Text>
                                ) : (
                                    <Table.ScrollContainer
                                        minWidth={380}
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
                                                            <Table.Td w={30}>
                                                                {(topUsersPage -
                                                                    1) *
                                                                    topUsersPerPage +
                                                                    i +
                                                                    1}
                                                            </Table.Td>
                                                            <Table.Td>
                                                                <Text size='sm'>
                                                                    {u.userName}
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
                                                                <Text size='sm'>
                                                                    {formatMoney(
                                                                        u.revenue,
                                                                    )}
                                                                </Text>
                                                                <Text
                                                                    size='xs'
                                                                    c='dimmed'
                                                                >
                                                                    {u.paid}{' '}
                                                                    purchases
                                                                </Text>
                                                            </Table.Td>
                                                        </Table.Tr>
                                                    ),
                                                )}
                                            </Table.Tbody>
                                        </Table>
                                    </Table.ScrollContainer>
                                )}
                                <TablePagination
                                    page={topUsersPage}
                                    perPage={topUsersPerPage}
                                    total={reports.topUsers.total}
                                    onChange={setTopUsersPage}
                                    loading={loading}
                                />
                            </Card>
                        </Grid.Col>
                    </Grid>
                </>
            )}
        </Stack>
    );
}
