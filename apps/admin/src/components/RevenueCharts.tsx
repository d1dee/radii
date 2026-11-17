import { BarChart } from '@mantine/charts';
import {
    ActionIcon,
    Card,
    Group,
    ScrollArea,
    Select,
    SimpleGrid,
    Stack,
    Text,
} from '@mantine/core';
import { useState } from 'react';
import { MdChevronLeft, MdChevronRight } from 'react-icons/md';

import type { AdminReports } from '@/lib/api';
import { formatMoney } from '@/lib/format';

type PackageRevenue = AdminReports['packageRevenue'];

function RevenueChartCard({
    packages,
    type,
    detail,
}: {
    packages: PackageRevenue;
    type: 'hotspot' | 'pppoe';
    detail: boolean;
}) {
    const [category, setCategory] = useState<string | null>(null);
    const service = type === 'hotspot' ? 'Hotspot' : 'PPPoE';
    const servicePackages = packages.filter((p) => p.type === type);
    const categories = [
        ...new Set(servicePackages.map((p) => p.category.trim() || 'Uncategorized')),
    ].sort((a, b) => a.localeCompare(b));
    const selectedCategory = category && categories.includes(category)
        ? category
        : (categories[0] ?? null);
    const filteredPackages = detail
        ? servicePackages.filter(
              (p) => (p.category.trim() || 'Uncategorized') === selectedCategory,
          )
        : servicePackages;
    const byCategory = !detail && type === 'hotspot';
    const categoryTotals = new Map<string, number>();
    if (byCategory) {
        for (const p of filteredPackages) {
            const name = p.category.trim() || 'Uncategorized';
            categoryTotals.set(name, (categoryTotals.get(name) ?? 0) + p.revenue);
        }
    }
    const data = (byCategory
        ? [...categoryTotals].map(([name, revenue]) => ({ id: name, name, revenue }))
        : filteredPackages.map((p) => ({
              id: p.packageId,
              name: `${p.title}${p.archivedAt ? ' (Archived)' : ''}`,
              revenue: p.revenue,
          })))
        .sort((a, b) => b.revenue - a.revenue || a.id.localeCompare(b.id));
    const labels = new Map(data.map((entry) => [entry.id, entry.name]));
    const cycleCategory = (direction: number) => {
        const index = categories.indexOf(selectedCategory ?? '');
        setCategory(categories[(index + direction + categories.length) % categories.length]);
    };

    return (
        <Card withBorder padding='md' h='100%' miw={0}>
            <Stack gap='sm'>
                <div>
                    <Text fw={600}>
                        {service} {detail ? 'package revenue by category' : `revenue by ${byCategory ? 'category' : 'package'}`}
                    </Text>
                    <Text size='xs' c='dimmed'>
                        {detail
                            ? 'Package earnings in the selected category.'
                            : byCategory
                              ? 'Combined package earnings for each category.'
                              : 'All package earnings across categories.'}
                        {' '}Paid payments in the selected date range.
                    </Text>
                </div>
                {detail && (
                    <Group gap='xs' wrap='nowrap'>
                        <ActionIcon
                            variant='default'
                            size='lg'
                            aria-label={`Previous ${service} category`}
                            disabled={categories.length < 2}
                            onClick={() => cycleCategory(-1)}
                        >
                            <MdChevronLeft size={20} />
                        </ActionIcon>
                        <Select
                            aria-label={`${service} revenue category`}
                            placeholder='No categories'
                            data={categories}
                            value={selectedCategory}
                            onChange={setCategory}
                            allowDeselect={false}
                            disabled={categories.length === 0}
                            searchable
                            style={{ flex: 1, minWidth: 0 }}
                        />
                        <ActionIcon
                            variant='default'
                            size='lg'
                            aria-label={`Next ${service} category`}
                            disabled={categories.length < 2}
                            onClick={() => cycleCategory(1)}
                        >
                            <MdChevronRight size={20} />
                        </ActionIcon>
                    </Group>
                )}
                <Text size='lg' fw={700}>
                    {formatMoney(data.reduce((total, entry) => total + entry.revenue, 0))}
                </Text>
                {data.length === 0 ? (
                    <Text size='sm' c='dimmed' py='xl'>
                        No paid {service} purchases in this range.
                    </Text>
                ) : (
                    <ScrollArea.Autosize mah={420} type='auto' offsetScrollbars>
                        <BarChart
                            h={Math.max(260, data.length * 44 + 40)}
                            data={data}
                            dataKey='id'
                            orientation='vertical'
                            series={[{
                                name: 'revenue',
                                label: 'Revenue',
                                color: type === 'hotspot' ? 'teal.6' : 'blue.6',
                            }]}
                            valueFormatter={formatMoney}
                            yAxisProps={{
                                width: 70,
                                tickMargin: 6,
                                interval: 0,
                                tickFormatter: (value: string) => labels.get(value) ?? value,
                            }}
                            xAxisProps={{ domain: [0, 'auto'] }}
                            tooltipProps={{
                                labelFormatter: (value) => labels.get(String(value)) ?? String(value),
                            }}
                            barChartProps={{ accessibilityLayer: true }}
                            maxBarWidth={28}
                        />
                    </ScrollArea.Autosize>
                )}
            </Stack>
        </Card>
    );
}

export function RevenueCharts({
    packages,
    detail = false,
}: {
    packages: PackageRevenue;
    detail?: boolean;
}) {
    return (
        <SimpleGrid cols={{ base: 1, lg: 2 }}>
            <RevenueChartCard packages={packages} type='hotspot' detail={detail} />
            <RevenueChartCard packages={packages} type='pppoe' detail={detail} />
        </SimpleGrid>
    );
}
