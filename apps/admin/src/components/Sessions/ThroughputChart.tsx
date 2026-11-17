import { getThroughputObservations } from '@/lib/api';
import { formatDateTime, formatTime } from '@/lib/format';
import { recordedThroughput } from '@/lib/throughput';
import { LineChart } from '@mantine/charts';
import { Card, Group, Stack, Text } from '@mantine/core';
import { useEffect, useState } from 'react';
import { MdArrowDownward, MdArrowUpward } from 'react-icons/md';

type Snapshot = ReturnType<typeof recordedThroughput>;

export function ThroughputChart({
    kind,
    id,
}: {
    kind: 'customer' | 'session';
    id: string;
}) {
    const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
    const [error, setError] = useState(false);

    useEffect(() => {
        let disposed = false;
        let timer: ReturnType<typeof setTimeout>;
        setSnapshot(null);
        setError(false);
        async function poll() {
            try {
                const result = await getThroughputObservations(kind, id);
                if (disposed) return;
                if (!result.success || !result.data)
                    throw new Error('Unavailable');
                setSnapshot(recordedThroughput(result.data, Date.now()));
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
    }, [kind, id]);

    const latest = snapshot?.latest;
    return (
        <Card withBorder padding='md' radius='md' style={{ minWidth: 0 }}>
            <Stack gap='xs'>
                <Text fw={600}>Average throughput</Text>
                <Text size='xs' c='dimmed'>
                    Average upload and download speeds for the latest recorded
                    hour, including ended sessions. Refreshes every 10 seconds;
                    gaps indicate missing data.
                    {kind === 'customer'
                        ? ' Overlapping recorded session intervals are summed; unrecorded sessions are not included.'
                        : ''}
                </Text>
                <Text size='sm' role='status' c={error ? 'red' : 'dimmed'}>
                    {error
                        ? 'Unable to refresh recorded usage; retrying. Any displayed history is from the last successful refresh.'
                        : snapshot?.status}
                </Text>
                <Group gap='xs'>
                    <Text size='sm'>Last recorded:</Text>
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
                            tickFormatter: (value: number) =>
                                formatTime(value, true),
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
