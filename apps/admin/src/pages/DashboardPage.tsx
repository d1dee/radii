import { AreaChart, DonutChart } from '@mantine/charts';
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
import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type ReactNode,
} from 'react';
import { MdChevronLeft, MdChevronRight, MdRefresh } from 'react-icons/md';

import { PageLayout } from '@/components/Layout/PageLayout';
import { PageTableScrollContainer } from '@/components/PageTableScrollContainer';
import { RevenueCharts } from '@/components/RevenueCharts';
import { RevenueTimelineChart } from '@/components/RevenueTimelineChart';
import { ThroughputChart } from '@/components/Sessions/ThroughputChart';
import { TablePagination } from '@/components/TablePagination';
import {
    getAdminReports,
    getAllNasDevices,
    getRadiusSummary,
    type AdminReports,
    type NetworkUsage,
    type NasDeviceRow,
} from '@/lib/api';
import { warnBackgroundFailure } from '@/lib/clientError';
import { dayjs } from '@/lib/dayjs';
import {
    formatBytes,
    formatMoney,
    formatSeconds,
    formatSpeed,
} from '@/lib/format';
import { tableRowNumber, useTablePageSize } from '@/lib/pagination';
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
    color,
}: {
    label: string;
    value: ReactNode;
    sub: string;
    color?: string;
}) {
    return (
        <Card withBorder padding='md' radius='md' miw={0}>
            <Text size='xs' c='dimmed' mih='2.8em' lh={1.4}>
                {label}
            </Text>
            <Text
                size='lg'
                fw={700}
                c={color}
                mt={2}
                style={{ overflowWrap: 'anywhere' }}
            >
                {value}
            </Text>
            <Text size='xs' c='dimmed' mt={2}>
                {sub}
            </Text>
        </Card>
    );
}

function NasThroughputCard({ from, to }: { from: Date; to: Date }) {
    const [devices, setDevices] = useState<NasDeviceRow[] | null>(null);
    const [nasIndex, setNasIndex] = useState(0);
    const [error, setError] = useState(false);
    const [retry, setRetry] = useState(0);

    useEffect(() => {
        let disposed = false;
        setError(false);
        async function load() {
            try {
                const result = await getAllNasDevices();
                if (disposed) return;
                if (!result.success || !result.data)
                    throw new Error('Unavailable');
                setDevices(
                    [...result.data].sort((a, b) => a.name.localeCompare(b.name)),
                );
                setNasIndex(0);
            } catch {
                if (!disposed) setError(true);
            }
        }
        void load();
        return () => {
            disposed = true;
        };
    }, [retry]);

    const deviceCount = devices?.length ?? 0;
    const device = devices?.[nasIndex];
    if (!device) {
        return (
            <Card withBorder padding='md' radius='md'>
                <Stack gap='xs'>
                    <Text fw={600}>NAS Average Thoughput</Text>
                    <Group>
                        <Text
                            size='sm'
                            c={error ? 'red' : 'dimmed'}
                            role='status'
                        >
                            {error
                                ? 'Unable to load NAS devices.'
                                : devices
                                  ? 'No NAS devices available.'
                                  : 'Loading NAS devices...'}
                        </Text>
                        {error ? (
                            <ActionIcon
                                variant='subtle'
                                aria-label='Retry loading NAS devices'
                                onClick={() => setRetry((value) => value + 1)}
                            >
                                <MdRefresh size={18} />
                            </ActionIcon>
                        ) : null}
                    </Group>
                </Stack>
            </Card>
        );
    }

    return (
        <ThroughputChart
            key={device.id}
            kind='nas'
            id={device.id}
            dateRange={{ from: from.toISOString(), to: to.toISOString() }}
            header={
                <Group justify='space-between' wrap='nowrap'>
                    <Stack gap={2} style={{ minWidth: 0 }}>
                        <Text fw={600}>NAS Average Thoughput</Text>
                        <Text
                            fw={600}
                            style={{ overflowWrap: 'anywhere' }}
                            aria-live='polite'
                        >
                            {device.name}
                        </Text>
                    </Stack>
                    <Group gap='xs' wrap='nowrap'>
                        <ActionIcon
                            variant='subtle'
                            aria-label='Previous NAS'
                            disabled={deviceCount < 2}
                            onClick={() =>
                                setNasIndex((index) =>
                                    (index - 1 + deviceCount) % deviceCount,
                                )
                            }
                        >
                            <MdChevronLeft size={22} />
                        </ActionIcon>
                        <Text
                            size='xs'
                            c='dimmed'
                            style={{ whiteSpace: 'nowrap' }}
                        >
                            {nasIndex + 1} / {deviceCount}
                        </Text>
                        <ActionIcon
                            variant='subtle'
                            aria-label='Next NAS'
                            disabled={deviceCount < 2}
                            onClick={() =>
                                setNasIndex((index) => (index + 1) % deviceCount)
                            }
                        >
                            <MdChevronRight size={22} />
                        </ActionIcon>
                    </Group>
                </Group>
            }
        />
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
    const [topUsersPerPage, setTopUsersPerPage] = useTablePageSize(6);
    const reportsRequest = useRef(0);

    const loadData = useCallback(
        async (rangeFrom: Date, rangeTo: Date, silent = false) => {
            const requestId = ++reportsRequest.current;
            if (!silent) {
                setLoading(true);
                setReports(null);
                setUsage(null);
            }
            setError(null);
            const [res, usageRes] = await Promise.all([
                getAdminReports(
                    rangeFrom.toISOString(),
                    rangeTo.toISOString(),
                    {
                        topPackagesPerPage: 10,
                        topUsersPage,
                        topUsersPerPage,
                        heavyUsersPerPage: 10,
                    },
                ),
                getRadiusSummary(rangeFrom.toISOString(), rangeTo.toISOString()),
            ]);
            if (requestId !== reportsRequest.current) return;
            setLoading(false);
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
            if (!usageRes.success || !usageRes.data) {
                if (silent)
                    warnBackgroundFailure(
                        'refresh dashboard network activity',
                        usageRes,
                    );
                else
                    setError(
                        (!usageRes.success && usageRes.message) ||
                            'Failed to load network activity',
                    );
                return;
            }
            setReports(res.data);
            setUsage(usageRes.data);
        },
        [topUsersPage, topUsersPerPage],
    );

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

        void loadData(range.from, range.to);
    }, [loaded, settings, loadData]);

    const autoRefreshData = useCallback(() => {
        const days = rangePresets.find((p) => p.label === preset)?.days ?? 30;
        const range = presetRange(days);
        setFrom(range.from);
        setTo(range.to);
        void loadData(range.from, range.to, true);
    }, [loadData, preset]);
    useEffect(() => {
        if (!loaded) return;
        const timer = setInterval(autoRefreshData, 10_000);
        return () => clearInterval(timer);
    }, [autoRefreshData, loaded]);

    useEffect(() => {
        if (!loaded || !reports) return;
        void loadData(from, to);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [topUsersPage, topUsersPerPage]);

    const applyPreset = (label: string) => {
        setTopUsersPage(1);
        setPreset(label);
        const found = rangePresets.find((p) => p.label === label);
        if (!found) return;
        const range = presetRange(found.days);
        setFrom(range.from);
        setTo(range.to);

        void loadData(range.from, range.to);
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

    return (
        <PageLayout
            label='Dashboard page content'
            header={
                <Group justify='space-between' wrap='wrap'>
                    <Stack gap={4}>
                        <Title order={3}>Dashboard</Title>
                        <Text size='sm' c='dimmed'>
                            Historical network activity and revenue overview for
                            the selected date range.
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
            }
        >
            <Card withBorder padding='md' radius='md'>
                <Group justify='space-between' mb='xs'>
                    <Group gap='xs'>
                        <Badge color='green' variant='dot' size='lg'>
                            Revenue & network overview
                        </Badge>
                        <Text size='xs' c='dimmed'>
                            Refreshes every 10 seconds
                        </Text>
                    </Group>
                    <Tooltip label='Refresh now'>
                        <ActionIcon
                            aria-label='Refresh revenue and network overview'
                            size='lg'
                            variant='subtle'
                            onClick={autoRefreshData}
                        >
                            <MdRefresh size={18} />
                        </ActionIcon>
                    </Tooltip>
                </Group>
                <Group>
                    {!reports ? (
                        <SimpleGrid cols={{ base: 2, lg: 5 }}>
                            {Array.from({ length: 5 }).map((_, i) => (
                                <Skeleton key={i} height={48} radius='sm' />
                            ))}
                        </SimpleGrid>
                    ) : (
                        <SimpleGrid cols={{ base: 2, lg: 5 }}>
                            <StatCard
                                label='Revenue'
                                color='teal'
                                value={formatMoney(reports.totals.revenue)}
                                sub={`${reports.totals.payments} payments in the selected range`}
                            />
                            <StatCard
                                label='Buyers'
                                color='blue'
                                value={String(reports.totals.buyers)}
                                sub='Distinct customers with paid orders, including free grants'
                            />
                            <StatCard
                                label='New users'
                                color='cyan'
                                value={String(reports.totals.newUsers)}
                                sub='Visible customers registered in the selected range'
                            />
                            <StatCard
                                label='New activations'
                                color='violet'
                                value={String(reports.totals.newActivations)}
                                sub={`PPPoE ${reports.totals.newActivationsByType.pppoe} / Hotspot ${reports.totals.newActivationsByType.hotspot} in the selected range`}
                            />
                            <StatCard
                                label='Avg per buyer'
                                color='teal'
                                value={
                                    reports.totals.buyers > 0
                                        ? formatMoney(
                                              reports.totals.revenue /
                                                  reports.totals.buyers,
                                          )
                                        : '—'
                                }
                                sub='Selected-range revenue divided by buyers'
                            />
                        </SimpleGrid>
                    )}{' '}
                    {!usage ? (
                        <SimpleGrid cols={{ base: 2, lg: 5 }}>
                            {Array.from({ length: 5 }).map((_, i) => (
                                <Skeleton key={i} height={48} radius='sm' />
                            ))}
                        </SimpleGrid>
                    ) : (
                        <SimpleGrid cols={{ base: 2, lg: 5 }}>
                            <StatCard
                                label='Sessions in range'
                                color='green'
                                value={String(usage.sessions)}
                                sub={`PPPoE ${usage.sessionsByType.pppoe} / Hotspot ${usage.sessionsByType.hotspot}`}
                            />
                            <StatCard
                                label='PPPoE activity / no activity'
                                value={
                                    <>
                                        <Text
                                            component='span'
                                            inherit
                                            c='green'
                                        >
                                            {usage.pppoeAccounts.withActivity} active
                                        </Text>
                                        {' / '}
                                        <Text component='span' inherit c='red'>
                                            {usage.pppoeAccounts.withoutActivity}{' '}
                                            inactive
                                        </Text>
                                    </>
                                }
                                sub='Accounts created by range end, with / without sessions in range'
                            />
                            <StatCard
                                label='Average throughput in range'
                                color='cyan'
                                value={formatSpeed(
                                    usage.averageThroughputBps,
                                )}
                                sub='Recorded data divided by elapsed time in the selected range'
                            />
                            <StatCard
                                label='Data in range'
                                color='blue'
                                value={formatBytes(usage.octets)}
                                sub='Upload + download attributed to accounting reports in range'
                            />
                            <StatCard
                                label='Average session time in range'
                                color='orange'
                                value={formatSeconds(usage.avgSessionSeconds)}
                                sub='Average session duration overlapping the selected range'
                            />
                        </SimpleGrid>
                    )}
                </Group>
            </Card>

            {error ? (
                <Text c='red'>{error}</Text>
            ) : loading ? (
                <Center py='xl'>
                    <Loader />
                </Center>
            ) : !reports ? null : (
                <>
                    <Stack gap='md' miw={0}>
                        <RevenueTimelineChart
                            timeline={reports.revenueTimeline}
                            hasPaidPurchases={reports.packageRevenue.length > 0}
                        />
                        <RevenueCharts packages={reports.packageRevenue} />
                    </Stack>
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
                                        data={reports.daily.map((entry) => ({
                                            ...entry,
                                            day: dayjs(entry.day).format(
                                                'DD MMM YYYY',
                                            ),
                                        }))}
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
                        {loaded ? (
                            <Grid.Col span={12}>
                                <NasThroughputCard from={from} to={to} />
                            </Grid.Col>
                        ) : null}
                        <Grid.Col span={12}>
                            <Card withBorder padding='md' h='100%'>
                                <Text fw={600} mb='sm'>
                                    Top customers
                                </Text>
                                {reports.topUsers.items.length === 0 ? (
                                    <Text size='sm' c='dimmed'>
                                        No paid purchases in this range.
                                    </Text>
                                ) : (
                                    <PageTableScrollContainer
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
                                                                {tableRowNumber(
                                                                    topUsersPage,
                                                                    topUsersPerPage,
                                                                    i,
                                                                )}
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
                                    </PageTableScrollContainer>
                                )}
                                <TablePagination
                                    page={topUsersPage}
                                    perPage={topUsersPerPage}
                                    total={reports.topUsers.total}
                                    onChange={setTopUsersPage}
                                    onPerPageChange={(value) => {
                                        setTopUsersPerPage(value);
                                        setTopUsersPage(1);
                                    }}
                                    loading={loading}
                                />
                            </Card>
                        </Grid.Col>
                    </Grid>
                </>
            )}
        </PageLayout>
    );
}
