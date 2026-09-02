import { AreaChart, DonutChart } from '@mantine/charts';
import {
    Badge,
    Button,
    Card,
    Center,
    Grid,
    Group,
    Loader,
    ScrollAreaAutosize,
    SimpleGrid,
    Stack,
    Table,
    Text,
    Title,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { notifications } from '@mantine/notifications';
import { useCallback, useEffect, useState } from 'react';

import { getAdminReports, type AdminReports } from '@/lib/api';
import { dayjs } from '@/lib/dayjs';
import { formatBytes, formatMoney, formatSeconds } from '@/lib/format';

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

export default function ReportsPage() {
    const [reports, setReports] = useState<AdminReports | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [from, setFrom] = useState<Date>(
        dayjs().subtract(30, 'day').startOf('day').toDate(),
    );
    const [to, setTo] = useState<Date>(dayjs().endOf('day').toDate());

    const load = useCallback(async (rangeFrom: Date, rangeTo: Date) => {
        setLoading(true);
        setError(null);
        const res = await getAdminReports(
            rangeFrom.toISOString(),
            rangeTo.toISOString(),
        );
        setLoading(false);
        if (!res.success) {
            setError(res.message || 'Failed to load reports');
            return;
        }
        if (!res.data) {
            setError('Failed to load reports');
            return;
        }
        setReports(res.data);
    }, []);

    useEffect(() => {
        void load(from, to);
    }, []); // initial load only; the Apply button drives the rest

    const apply = () => {
        if (from.getTime() > to.getTime()) {
            notifications.show({ color: 'red', message: 'Invalid date range' });
            return;
        }
        void load(from, dayjs(to).endOf('day').toDate());
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
        <>
            <Group justify='space-between' wrap='wrap' mb='md'>
                <Title order={1}>Reports</Title>
                <Group>
                    <DateInput
                        label='From'
                        value={from}
                        onChange={(v) => v && setFrom(new Date(v))}
                        w={150}
                    />
                    <DateInput
                        label='To'
                        value={to}
                        onChange={(v) => v && setTo(new Date(v))}
                        w={150}
                    />
                    <Button onClick={apply} mt='lg'>
                        Apply
                    </Button>
                </Group>
            </Group>

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
                    <ScrollAreaAutosize>
                        <Stack>
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
                                                h='100%'
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
                                                    size={280}
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
                                        <Group
                                            justify='center'
                                            gap='md'
                                            mt='sm'
                                        >
                                            {statusBreakdown.map((s) => (
                                                <Group key={s.name} gap={4}>
                                                    <Badge
                                                        size='xs'
                                                        color={s.color}
                                                        variant='filled'
                                                    >
                                                        {s.value}
                                                    </Badge>
                                                    <Text size='xs'>
                                                        {s.name}
                                                    </Text>
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
                                        {reports.topPackages.length === 0 ? (
                                            <Text size='sm' c='dimmed'>
                                                No paid purchases in this range.
                                            </Text>
                                        ) : (
                                            <Table striped h='100%'>
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
                                                    {reports.topPackages.map(
                                                        (p, i) => (
                                                            <Table.Tr
                                                                key={
                                                                    p.packageId
                                                                }
                                                            >
                                                                <Table.Td>
                                                                    {i + 1}
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
                                        )}
                                    </Card>
                                </Grid.Col>
                                <Grid.Col span={{ base: 12, lg: 6 }}>
                                    <Card withBorder padding='md' h='100%'>
                                        <Text fw={600} mb='sm'>
                                            Top customers by spend
                                        </Text>
                                        {reports.topUsers.length === 0 ? (
                                            <Text size='sm' c='dimmed'>
                                                No paid purchases in this range.
                                            </Text>
                                        ) : (
                                            <Table striped>
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
                                                    {reports.topUsers.map(
                                                        (u, i) => (
                                                            <Table.Tr
                                                                key={u.userId}
                                                            >
                                                                <Table.Td>
                                                                    {i + 1}
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
                                        )}
                                    </Card>
                                </Grid.Col>
                                <Grid.Col span={12}>
                                    <Card withBorder padding='md'>
                                        <Text fw={600} mb='sm'>
                                            Heaviest consumers (RADIUS
                                            accounting)
                                        </Text>
                                        {reports.topUsage.length === 0 ? (
                                            <Text size='sm' c='dimmed'>
                                                No sessions in this range.
                                            </Text>
                                        ) : (
                                            <Table striped>
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
                                                    {reports.topUsage.map(
                                                        (u, i) => (
                                                            <Table.Tr
                                                                key={u.username}
                                                            >
                                                                <Table.Td>
                                                                    {i + 1}
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
                                        )}
                                    </Card>
                                </Grid.Col>
                            </Grid>
                        </Stack>
                    </ScrollAreaAutosize>
                </>
            )}
        </>
    );
}
