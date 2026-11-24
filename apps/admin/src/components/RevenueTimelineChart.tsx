import { BarChart } from '@mantine/charts';
import { Card, Group, Text } from '@mantine/core';

import type { AdminReports } from '@/lib/api';
import { dayjs } from '@/lib/dayjs';
import { formatMoney } from '@/lib/format';

export function RevenueTimelineChart({
    timeline,
    hasPaidPurchases,
}: {
    timeline: AdminReports['revenueTimeline'];
    hasPaidPurchases: boolean;
}) {
    const totals = { hotspot: 0, pppoe: 0 };
    for (const bucket of timeline.items) {
        totals.hotspot += bucket.hotspot;
        totals.pppoe += bucket.pppoe;
    }
    const tickFormat = timeline.unit === 'minute' || timeline.unit === 'hour'
        ? 'HH:mm' : 'DD MMM YYYY';

    return (
        <Card withBorder padding='md' miw={0}>
            <Text fw={600}>Hotspot and PPPoE earnings</Text>
            <Text size='xs' c='dimmed' mb='sm'>
                Paid earnings per {timeline.unit} in the selected range.
            </Text>
            <Group gap='lg' mb='sm'>
                <Text size='sm' c='teal.6' fw={600}>
                    Hotspot: {formatMoney(totals.hotspot)}
                </Text>
                <Text size='sm' c='blue.6' fw={600}>
                    PPPoE: {formatMoney(totals.pppoe)}
                </Text>
            </Group>
            {!hasPaidPurchases ? (
                <Text size='sm' c='dimmed' py='xl'>
                    No paid purchases in this range.
                </Text>
            ) : (
                <BarChart
                    h={280}
                    data={timeline.items}
                    dataKey='start'
                    series={[
                        { name: 'hotspot', label: 'Hotspot', color: 'teal.6' },
                        { name: 'pppoe', label: 'PPPoE', color: 'blue.6' },
                    ]}
                    withLegend
                    valueFormatter={formatMoney}
                    xAxisProps={{
                        tickFormatter: (value: string) => dayjs(value).format(tickFormat),
                        minTickGap: 30,
                    }}
                    tooltipProps={{
                        labelFormatter: (value) => dayjs(String(value)).format('DD MMM YYYY HH:mm'),
                    }}
                    yAxisProps={{ width: 90, domain: [0, 'auto'] }}
                    maxBarWidth={80}
                    barChartProps={{ accessibilityLayer: true }}
                />
            )}
        </Card>
    );
}
