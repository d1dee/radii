import {
    getNasThroughput,
    getThroughputObservations,
    type ThroughputDateRange,
    type ThroughputRange,
} from '@/lib/api';
import { formatDate, formatDateTime, formatTime } from '@/lib/format';
import {
    bucketedThroughput,
    recordedThroughput,
    throughputGapTransitions,
} from '@/lib/throughput';
import { ChartTooltip, LineChart } from '@mantine/charts';
import {
    Card,
    Group,
    Paper,
    SegmentedControl,
    Stack,
    Text,
} from '@mantine/core';
import { useEffect, useState, type PointerEvent, type ReactNode } from 'react';
import { MdArrowDownward, MdArrowUpward } from 'react-icons/md';
import {
    ReferenceLine,
    useXAxisInverseScale,
    type TooltipContentProps,
} from 'recharts';

type Snapshot = ReturnType<typeof recordedThroughput>;

function ThroughputTooltip({
    active,
    label,
    payload,
    pointerX,
    gaps,
}: TooltipContentProps<number, string> & {
    pointerX: number | null;
    gaps: Snapshot['gaps'];
}) {
    const inverse = useXAxisInverseScale();
    if (!active) return null;
    // Axis tooltips snap to samples. Test the unsnapped pointer time as well,
    // especially near gap edges where the closest sample can be measured.
    const at =
        pointerX === null || !inverse
            ? Number(label)
            : Number(inverse(pointerX));
    const gap = gaps.find((gap) => at >= gap.from && at <= gap.to);
    const missing = gap || payload.every((item) => item.value == null);
    if (missing) {
        return (
            <Paper px='md' py='sm' withBorder shadow='md'>
                <Text size='sm' fw={500}>
                    {formatDateTime(at, true)}
                </Text>
                <Text size='sm' c='red'>
                    No data (missing recorded usage)
                </Text>
            </Paper>
        );
    }
    return (
        <ChartTooltip
            label={formatDateTime(Number(label), true)}
            payload={payload}
            valueFormatter={(value) => `${value.toFixed(1)} Mbps`}
        />
    );
}

export function ThroughputChart({
    kind,
    id,
    range: controlledRange,
    onRangeChange,
    dateRange,
    header,
}: {
    kind: 'customer' | 'session' | 'nas';
    id: string;
    range?: ThroughputRange;
    onRangeChange?: (range: ThroughputRange) => void;
    dateRange?: ThroughputDateRange;
    header?: ReactNode;
}) {
    const [selectedRange, setSelectedRange] = useState<ThroughputRange>(
        kind === 'session' ? 'hour' : 'day',
    );
    const range = controlledRange ?? selectedRange;
    const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
    const [error, setError] = useState(false);
    const [pointerX, setPointerX] = useState<number | null>(null);
    function trackPointer(event: PointerEvent<HTMLDivElement>) {
        const chart = event.currentTarget.querySelector('.recharts-wrapper');
        if (!(chart instanceof HTMLElement)) return;
        const bounds = chart.getBoundingClientRect();
        if (bounds.width > 0)
            setPointerX(
                ((event.clientX - bounds.left) * chart.offsetWidth) /
                    bounds.width,
            );
    }
    const from = dateRange?.from;
    const to = dateRange?.to;

    useEffect(() => {
        let disposed = false;
        let timer: ReturnType<typeof setTimeout>;
        setSnapshot(null);
        setError(false);
        async function poll() {
            try {
                if (kind === 'nas') {
                    const result = await getNasThroughput(
                        id,
                        from && to ? { from, to } : range,
                    );
                    if (disposed) return;
                    if (!result.success || !result.data)
                        throw new Error('Unavailable');
                    setSnapshot(
                        bucketedThroughput(
                            result.data,
                            Date.now(),
                            from && to ? { from, to } : range,
                        ),
                    );
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
    }, [kind, id, range, from, to]);

    const latest = snapshot?.latest;
    const hasMeasurements = snapshot?.points.some(
        (point) => point.Upload !== null || point.Download !== null,
    );
    const transitions = snapshot
        ? throughputGapTransitions(snapshot.points, snapshot.gaps)
        : [];
    const rangeLabel =
        range === 'hour' ? 'hour' : range === 'day' ? '24 hours' : '30 days';
    const showDates =
        from && to
            ? Date.parse(to) - Date.parse(from) > 86_400_000
            : range === 'month';
    const period =
        from && to
            ? `for the selected date range, ${formatDate(from)} to ${formatDate(to)}`
            : `for the latest recorded ${rangeLabel}`;
    return (
        <Card withBorder padding='md' radius='md' style={{ minWidth: 0 }}>
            <Stack gap='xs'>
                {header ?? (
                    <Group justify='space-between'>
                        <Text fw={600}>Average throughput</Text>
                        {!dateRange ? (
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
                        ) : null}
                    </Group>
                )}
                <Text size='xs' c='dimmed'>
                    Average upload and download speeds {period}, including ended
                    sessions. Refreshes every 10 seconds; lines drop to a red
                    dashed zero baseline during missing intervals. No data means
                    missing recorded usage, not measured zero traffic.
                    {kind !== 'session'
                        ? ' Overlapping recorded session intervals are summed; unrecorded sessions are not included.'
                        : ''}
                </Text>
                {!snapshot && !error ? (
                    <Text size='sm' c='dimmed' role='status'>
                        Loading recorded usage...
                    </Text>
                ) : null}
                {snapshot && !hasMeasurements ? (
                    <Text size='sm' c='red' role='status'>
                        No data:{' '}
                        {snapshot.status ||
                            'No recorded usage in this time range.'}
                    </Text>
                ) : null}
                {/*  {snapshot && snapshot.gaps.length > 0 ? (
                    <Group gap={6}>
                        <span
                            aria-hidden='true'
                            style={{
                                width: 24,
                                borderTop:
                                    '2px dashed var(--mantine-color-red-6)',
                            }}
                        />
                        <Text size='xs' c='red'>
                            No data (missing recorded usage)
                        </Text>
                    </Group>
                ) : null} */}
                <Text size='sm' role='status' c={error ? 'red' : 'dimmed'}>
                    {error
                        ? 'Unable to refresh recorded usage; retrying. Any displayed history is from the last successful refresh.'
                        : null}
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
                        withTooltip
                        onPointerMoveCapture={trackPointer}
                        onPointerDownCapture={trackPointer}
                        onMouseLeave={() => setPointerX(null)}
                        onKeyDownCapture={() => setPointerX(null)}
                        connectNulls={false}
                        curveType='monotone'
                        xAxisProps={{
                            type: 'number',
                            domain: snapshot.domain,
                            minTickGap: 30,
                            tickFormatter: (value: number) =>
                                showDates
                                    ? formatDate(value)
                                    : formatTime(value, range === 'hour'),
                        }}
                        tooltipProps={{
                            filterNull: false,
                            content: (props) => (
                                <ThroughputTooltip
                                    {...props}
                                    pointerX={pointerX}
                                    gaps={snapshot.gaps}
                                />
                            ),
                        }}
                        yAxisProps={{
                            domain: [0, hasMeasurements ? 'auto' : 1],
                            width: 65,
                            tick: hasMeasurements,
                        }}
                        valueFormatter={(value) => `${value.toFixed(1)} Mbps`}
                    >
                        {/* Presentation-only connectors leave missing measurements null. */}
                        {transitions.map(({ series, segment }, index) => (
                            <ReferenceLine
                                key={`${series}-${index}`}
                                segment={segment}
                                stroke={`var(--mantine-color-${series === 'Upload' ? 'teal' : 'blue'}-6)`}
                                strokeWidth={2}
                            />
                        ))}
                        {snapshot.gaps.map((gap) => (
                            <ReferenceLine
                                key={gap.from}
                                segment={[
                                    { x: gap.from, y: 0 },
                                    { x: gap.to, y: 0 },
                                ]}
                                ifOverflow='extendDomain'
                                stroke='var(--mantine-color-red-6)'
                                strokeWidth={2}
                                strokeDasharray='6 4'
                                label={
                                    gap.to - gap.from >=
                                    (snapshot.domain[1] - snapshot.domain[0]) *
                                        0.12
                                        ? {
                                              value: 'No data',
                                              position: 'top',
                                              fill: 'var(--mantine-color-red-6)',
                                              fontSize: 12,
                                          }
                                        : undefined
                                }
                            />
                        ))}
                    </LineChart>
                ) : null}
            </Stack>
        </Card>
    );
}
