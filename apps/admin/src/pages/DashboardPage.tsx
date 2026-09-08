import { AreaChart, BarChart, DonutChart } from '@mantine/charts';
import {
    ActionIcon,
    Badge,
    Button,
    Card,
    Center,
    Grid,
    Group,
    Loader,
    Paper,
    SegmentedControl,
    SimpleGrid,
    Skeleton,
    Stack,
    Table,
    Text,
    Title,
    Tooltip,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { notifications } from '@mantine/notifications';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    MdPeople,
    MdReceiptLong,
    MdRefresh,
    MdRouter,
    MdStorage,
    MdBarChart,
    MdWifiTethering,
} from 'react-icons/md';

import {
    getAdminReports,
    getRadiusSummary,
    type AdminReports,
    type NetworkUsage,
} from '@/lib/api';
import { useAutoRefresh } from '@/lib/autoRefresh';
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
                : dayjs().subtract(days - 1, 'day').startOf('day').toDate(),
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
        <Card withBorder padding='md' radius='md'>
            <Text size='xs' c='dimmed'>
                {label}
            </Text>
            <Text size='xl' fw={700} mt={2}>
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

const quickLinks = [
    { to: '/users', label: 'Users', icon: MdPeople },
    { to: '/packages', label: 'Packages', icon: MdRouter },
    { to: '/sessions', label: 'Live Sessions', icon: MdWifiTethering },
    { to: '/payments', label: 'Payments', icon: MdReceiptLong },
    { to: '/nas-devices', label: 'NAS Devices', icon: MdStorage },
    { to: '/reports', label: 'Full Reports', icon: MdBarChart },
];

export default function DashboardPage() {
    const { settings, loaded } = useAdminSettings();
    const [reports, setReports] = useState<AdminReports | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [usage, setUsage] = useState<NetworkUsage | null>(null);
    const [preset, setPreset] = useState('30d');
    const [from, setFrom] = useState<Date>(
        () => presetRange(30).from,
    );
    const [to, setTo] = useState<Date>(() => presetRange(30).to);

    const loadReports = useCallback(
        async (rangeFrom: Date, rangeTo: Date, silent = false) => {
            if (!silent) setLoading(true);
            setError(null);
            const res = await getAdminReports(
                rangeFrom.toISOString(),
                rangeTo.toISOString(),
            );
            if (!silent) setLoading(false);
            if (!res.success) {
                setError(res.message || 'Failed to load dashboard data');
                return;
            }
            if (!res.data) {
                setError('Failed to load dashboard data');
                return;
            }
            setReports(res.data);
        },
        [],
    );

    const loadUsage = useCallback(async () => {
        const res = await getRadiusSummary(60);
        if (res.success && res.data) setUsage(res.data);
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

    const applyPreset = (label: string) => {
        setPreset(label);
        const found = rangePresets.find((p) => p.label === label);
        if (!found) return;
        const range = presetRange(found.days);
        setFrom(range.from);
        setTo(range.to);
        void loadReports(range.from, range.to);
    };

    const apply = () => {
        if (from.getTime() > to.getTime()) {
            notifications.show({ color: 'red', message: 'Invalid date range' });
            return;
        }
        setPreset('');
        const rangeTo = dayjs(to).endOf('day').toDate();
        setTo(rangeTo);
        void loadReports(dayjs(from).startOf('day').toDate(), rangeTo);
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

    const packageChartData = (reports?.topPackages ?? []).map((p) => ({
        package: p.title,
        revenue: p.revenue,
        paid: p.paid,
    }));

    return (
        <Stack gap='md'>
            <Group justify='space-between' wrap='wrap'>
                <Stack gap={4}>
                    <Title order={1}>Dashboard</Title>
                    <Text size='sm' c='dimmed'>
                        Live network activity and revenue overview for the
                        selected date range.
                    </Text>
                </Stack>
                <Group wrap='wrap'>
                    <SegmentedControl
                        value={preset}
                        onChange={applyPreset}
                        data={rangePresets.map((p) => p.label)}
                    />
                    <DateInput
                        value={from}
                        onChange={(v) => v && setFrom(new Date(v))}
                        placeholder='From'
                        w={130}
                    />
                    <DateInput
                        value={to}
                        onChange={(v) => v && setTo(new Date(v))}
                        placeholder='To'
                        w={130}
                    />
                    <Button onClick={apply}>Apply</Button>
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

            {/* Quick access */}
            <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }}>
                {quickLinks.map((link) => (
                    <Paper
                        key={link.to}
                        component={Link}
                        to={link.to}
                        withBorder
                        radius='md'
                        p='md'
                        style={{ textDecoration: 'none' }}
                    >
                        <Group gap='sm'>
                            <link.icon size={20} />
                            <Text size='sm' fw={500}>
                                {link.label}
                            </Text>
                        </Group>
                    </Paper>
                ))}
            </SimpleGrid>

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
                                {reports.topUsers.length === 0 ? (
                                    <Text size='sm' c='dimmed'>
                                        No paid purchases in this range.
                                    </Text>
                                ) : (
                                    <Table striped verticalSpacing={6}>
                                        <Table.Tbody>
                                            {reports.topUsers.slice(0, 6).map(
                                                (u, i) => (
                                                    <Table.Tr key={u.userId}>
                                                        <Table.Td w={30}>
                                                            {i + 1}
                                                        </Table.Td>
                                                        <Table.Td>
                                                            <Text size='sm'>
                                                                {u.userName}
                                                            </Text>
                                                            <Text
                                                                size='xs'
                                                                c='dimmed'
                                                            >
                                                                {u.phoneNumber}
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
                                )}
                            </Card>
                        </Grid.Col>
                    </Grid>
                </>
            )}
        </Stack>
    );
}
