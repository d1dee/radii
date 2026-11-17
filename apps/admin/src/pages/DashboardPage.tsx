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
import { MdRefresh } from 'react-icons/md';

import { PageLayout } from '@/components/Layout/PageLayout';
import { PageTableScrollContainer } from '@/components/PageTableScrollContainer';
import { RevenueCharts } from '@/components/RevenueCharts';
import { TablePagination } from '@/components/TablePagination';
import {
    getAdminReports,
    getRadiusSummary,
    type AdminReports,
    type NetworkUsage,
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
        [topUsersPage, topUsersPerPage],
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

    // Network figures are independent of the selected report date range.
    useEffect(() => {
        void loadUsage();
    }, [loadUsage]);

    const autoRefreshData = useCallback(() => {
        void loadUsage();
        const days = rangePresets.find((p) => p.label === preset)?.days ?? 30;
        const range = presetRange(days);
        setFrom(range.from);
        setTo(range.to);
        void loadReports(range.from, range.to, true);
    }, [loadUsage, loadReports, preset]);
    useEffect(() => {
        if (!loaded) return;
        const timer = setInterval(autoRefreshData, 10_000);
        return () => clearInterval(timer);
    }, [autoRefreshData, loaded]);

    useEffect(() => {
        if (!loaded || !reports) return;
        void loadReports(from, to);
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

    return (
        <PageLayout
            label='Dashboard page content'
            header={
                <Group justify='space-between' wrap='wrap'>
                    <Stack gap={4}>
                        <Title order={3}>Dashboard</Title>
                        <Text size='sm' c='dimmed'>
                            Current accounting sessions and revenue overview for
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
            {/* Accounting totals are independent of the revenue date range. */}
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
                                label='Online sessions'
                                color='green'
                                value={String(usage.liveSessions)}
                                sub={`PPPoE ${usage.sessionsByType.pppoe} / Hotspot ${usage.sessionsByType.hotspot}`}
                            />
                            <StatCard
                                label='PPPoE online / offline'
                                value={
                                    <>
                                        <Text
                                            component='span'
                                            inherit
                                            c='green'
                                        >
                                            {usage.pppoeAccounts.online} online
                                        </Text>
                                        {' / '}
                                        <Text component='span' inherit c='red'>
                                            {usage.pppoeAccounts.offline}{' '}
                                            offline
                                        </Text>
                                    </>
                                }
                                sub='Service accounts excluding closed accounts'
                            />
                            <StatCard
                                label='Combined average session speed'
                                color='cyan'
                                value={formatSpeed(
                                    usage.aggregateThroughputBps,
                                )}
                                sub={`Lifetime avg ${formatSpeed(usage.avgSpeedPerSessionBps)}/session, not current throughput`}
                            />
                            <StatCard
                                label='Online-session data'
                                color='blue'
                                value={formatBytes(usage.liveOctets)}
                                sub='Upload + download since session start'
                            />
                            <StatCard
                                label='Average online session age'
                                color='orange'
                                value={formatSeconds(usage.avgSessionSeconds)}
                                sub='Average elapsed time since session start'
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
                    <RevenueCharts packages={reports.packageRevenue} />
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
