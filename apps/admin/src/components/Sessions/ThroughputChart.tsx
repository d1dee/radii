import {
    getNasThroughput,
    getThroughputObservations,
    type ThroughputRange,
} from '@/lib/api';
import { formatDate, formatDateTime, formatTime } from '@/lib/format';
import { recordedThroughput } from '@/lib/throughput';
import { LineChart } from '@mantine/charts';
import { Card, Group, SegmentedControl, Stack, Text } from '@mantine/core';
import { useEffect, useState } from 'react';
import { MdArrowDownward, MdArrowUpward } from 'react-icons/md';

type Snapshot = ReturnType<typeof recordedThroughput>;

export function ThroughputChart({
    kind,
    id,
    range: controlledRange,
    onRangeChange,
}: {
    kind: 'customer' | 'session' | 'nas';
    id: string;
    range?: ThroughputRange;
    onRangeChange?: (range: ThroughputRange) => void;
}) {
    const [selectedRange, setSelectedRange] = useState<ThroughputRange>('day');
    const range = controlledRange ?? selectedRange;
    const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
    const [error, setError] = useState(false);

    useEffect(() => {
        let disposed = false;
        let timer: ReturnType<typeof setTimeout>;
        setSnapshot(null);
        setError(false);
        async function poll() {
            try {
                if (kind === 'nas') {
                    const result = await getNasThroughput(id, range);
                    if (disposed) return;
                    if (!result.success || !result.data)
                        throw new Error('Unavailable');
                    const { points, bucketSeconds } = result.data;
                    const last = points.findLast(
                        (point) =>
                            point.Upload !== null && point.Download !== null,
                    );
                    setSnapshot({
                        points,
                        status: last
                            ? `Average rates in ${bucketSeconds / 60}-minute intervals; timestamps mark interval midpoints.`
                            : 'No recorded usage in this time range.',
                        latest: last
                            ? {
                                  upload: last.Upload!,
                                  download: last.Download!,
                                  at: last.at,
                              }
                            : null,
                    });
                } else {
                    const result = await getThroughputObservations(
                        kind,
                        id,
                        range,
                    );
                    if (disposed) return;
                    if (!result.success || !result.data)
                        throw new Error('Unavailable');
                    setSnapshot(
                        recordedThroughput(result.data, Date.now(), range),
                    );
                }
                setError(false);
            } catch {
                if (disposed) return;
                setError(true);
            }
            if (!disposed) timer = setTimeout(poll, 10_000);
        }
        void poll();
        return () => {
            disposed = true;
            clearTimeout(timer);
        };
    }, [kind, id, range]);

    const latest = snapshot?.latest;
    const rangeLabel =
        range === 'hour' ? 'hour' : range === 'day' ? '24 hours' : '30 days';
    return (
        <Card withBorder padding='md' radius='md' style={{ minWidth: 0 }}>
            <Stack gap='xs'>
                <Group justify='space-between'>
                    <Text fw={600}>Average throughput</Text>
                    <SegmentedControl
                        aria-label='Throughput time range'
                        size='xs'
                        value={range}
                        onChange={(value) =>
                            (onRangeChange ?? setSelectedRange)(
                                value as ThroughputRange,
                            )
                        }
                        data={[
                            { label: '1 hr', value: 'hour' },
                            { label: '1 day', value: 'day' },
                            { label: '1 month', value: 'month' },
                        ]}
                    />
                </Group>
                <Text size='xs' c='dimmed'>
                    {kind === 'nas'
                        ? `Recorded subscriber upload and download on this NAS over the past ${rangeLabel}. Excludes non-RADIUS traffic.`
                        : `Average upload and download speeds for the latest recorded ${rangeLabel}, including ended sessions.`}
                    {' '}Refreshes every 10 seconds; gaps indicate missing data.
                    {kind === 'customer'
                        ? ' Overlapping recorded session intervals are summed; unrecorded sessions are not included.'
                        : ''}
                </Text>
                <Text size='sm' role='status' c={error ? 'red' : 'dimmed'}>
                    {error
                        ? 'Unable to refresh recorded usage; retrying. Any displayed history is from the last successful refresh.'
                        : snapshot?.status ?? 'Loading recorded usage...'}
                </Text>
                <Group gap='xs'>
                    <Text size='sm'>
                        {kind === 'nas'
                            ? 'Last recorded bucket:'
                            : 'Last recorded:'}
                    </Text>
                    <Group gap={4} wrap='nowrap'>
                        <MdArrowUpward
                            aria-hidden='true'
                            color='var(--mantine-color-teal-6)'
                        />
                        <Text size='sm'>
                            Upload: {latest?.upload.toFixed(1) ?? '--'} Mbps
                        </Text>
                    </Group>
                    <Group gap={4} wrap='nowrap'>
                        <MdArrowDownward
                            aria-hidden='true'
                            color='var(--mantine-color-blue-6)'
                        />
                        <Text size='sm'>
                            Download: {latest?.download.toFixed(1) ?? '--'} Mbps
                        </Text>
                    </Group>
                    {latest && (
                        <Text size='sm'>{formatDateTime(latest.at, true)}</Text>
                    )}
                </Group>
                {snapshot && snapshot.points.length > 0 ? (
                    <LineChart
                        h={220}
                        data={snapshot.points}
                        dataKey='at'
                        series={[
                            { name: 'Upload', color: 'teal.6' },
                            { name: 'Download', color: 'blue.6' },
                        ]}
                        withLegend
                        withDots={false}
                        connectNulls={false}
                        curveType='monotone'
                        xAxisProps={{
                            type: 'number',
                            domain: ['dataMin', 'dataMax'],
                            minTickGap: 30,
                            tickFormatter: (value: number) =>
                                range === 'month'
                                    ? formatDate(value)
                                    : formatTime(value, range === 'hour'),
                        }}
                        tooltipProps={{
                            labelFormatter: (value) =>
                                formatDateTime(Number(value), true),
                        }}
                        yAxisProps={{ domain: [0, 'auto'], width: 65 }}
                        valueFormatter={(value) => `${value.toFixed(1)} Mbps`}
                    />
                ) : null}
            </Stack>
        </Card>
    );
}
