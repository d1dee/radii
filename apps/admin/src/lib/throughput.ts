import type {
    NasThroughput,
    ThroughputDateRange,
    ThroughputObservation,
    ThroughputRange,
} from './api';

const rangeMilliseconds = {
    hour: 3_600_000,
    day: 86_400_000,
    month: 30 * 86_400_000,
};

type MissingInterval = { from: number; to: number };

export type ThroughputPoint = {
    at: number;
    Upload: number | null;
    Download: number | null;
};

// Presentation geometry only: these zero endpoints must never enter measured
// points, latest readings, or rate tooltip payloads.
export function throughputGapTransitions(
    points: ThroughputPoint[],
    gaps: MissingInterval[],
) {
    const transitions: {
        series: 'Upload' | 'Download';
        segment: [{ x: number; y: number }, { x: number; y: number }];
    }[] = [];
    let index = 0;
    for (const gap of gaps) {
        while (index < points.length && points[index]!.at < gap.from) index++;
        const first = index;
        while (index < points.length && points[index]!.at <= gap.to) index++;
        for (const series of ['Upload', 'Download'] as const) {
            if (
                !points.slice(first, index).some((point) => point[series] === null)
            )
                continue;
            const before = points[first - 1];
            const after = points[index];
            if (before && before[series] !== null) {
                transitions.push({
                    series,
                    segment: [
                        { x: before.at, y: before[series] },
                        { x: gap.from, y: 0 },
                    ],
                });
            }
            if (after && after[series] !== null) {
                transitions.push({
                    series,
                    segment: [
                        { x: gap.to, y: 0 },
                        { x: after.at, y: after[series] },
                    ],
                });
            }
        }
    }
    return transitions;
}

export function recordedThroughput(
    observations: ThroughputObservation[],
    now: number,
    range: ThroughputRange = 'hour',
) {
    const intervals = observations.flatMap((row) => {
        const from = row.intervalStartedAt
            ? Date.parse(row.intervalStartedAt)
            : NaN;
        const to = Date.parse(row.observedAt);
        if (
            !Number.isFinite(from) ||
            !Number.isFinite(to) ||
            from >= to ||
            to > now ||
            !/^\d+$/.test(row.inputOctets) ||
            !/^\d+$/.test(row.outputOctets)
        )
            return [];
        const seconds = (to - from) / 1000;
        const upload = (Number(row.inputOctets) * 8) / seconds / 1_000_000;
        const download = (Number(row.outputOctets) * 8) / seconds / 1_000_000;
        return Number.isFinite(upload) && Number.isFinite(download)
            ? [{ from, to, upload, download }]
            : [];
    });
    const latestEnd = intervals.reduce(
        (latest, row) => Math.max(latest, row.to),
        -Infinity,
    );
    const end = Number.isFinite(latestEnd) ? latestEnd : now;
    const start = end - rangeMilliseconds[range];
    const events = new Map<
        number,
        { count: number; upload: number; download: number }
    >();
    for (const row of intervals) {
        if (row.to <= start) continue;
        for (const [at, direction] of [
            [Math.max(start, row.from), 1],
            [row.to, -1],
        ] as const) {
            const event = events.get(at) ?? { count: 0, upload: 0, download: 0 };
            event.count += direction;
            event.upload += row.upload * direction;
            event.download += row.download * direction;
            events.set(at, event);
        }
    }
    const boundaries = [...events.keys()].sort((a, b) => a - b);
    const points: ThroughputPoint[] = [];
    const gaps: MissingInterval[] = [];
    let count = 0;
    let upload = 0;
    let download = 0;
    // Sweep interval boundaries once so day/month histories do not repeatedly
    // scan all observations. Only simultaneously recorded intervals are summed.
    for (let i = 1; i < boundaries.length; i++) {
        const from = boundaries[i - 1]!;
        const to = boundaries[i]!;
        const event = events.get(from)!;
        count += event.count;
        upload += event.upload;
        download += event.download;
        if (count === 0) upload = download = 0;
        const Upload = count ? Math.max(0, upload) : null;
        const Download = count ? Math.max(0, download) : null;
        if (!count) gaps.push({ from, to });
        // One sample per interval avoids duplicate timestamps and vertical steps.
        // Keep the outer boundaries so the full recorded time range is visible.
        if (i === 1) points.push({ at: from, Upload, Download });
        points.push({ at: from + (to - from) / 2, Upload, Download });
        if (i === boundaries.length - 1) points.push({ at: to, Upload, Download });
    }
    const last = points.at(-1);
    const domain: [number, number] = [points[0]?.at ?? start, end];
    if (!points.length) {
        gaps.push({ from: start, to: end });
        points.push(
            { at: start, Upload: null, Download: null },
            { at: end, Upload: null, Download: null },
        );
    }
    return {
        points,
        gaps,
        domain,
        status:
            observations.length === 0
                ? 'No recorded usage.'
                : intervals.length === 0
                  ? 'Recorded usage has no valid interval boundaries.'
                  : '',
        latest:
            last && last.Upload !== null && last.Download !== null
                ? { upload: last.Upload, download: last.Download, at: last.at }
                : null,
    };
}

export function bucketedThroughput(
    { points, bucketSeconds }: NasThroughput,
    now: number,
    range: ThroughputRange | ThroughputDateRange,
) {
    const bucket = bucketSeconds * 1000;
    // NAS timestamps are interval midpoints. Recover the last (possibly partial)
    // bucket's end from its start, not by extending every midpoint half a bucket.
    const start =
        typeof range !== 'string'
            ? Date.parse(range.from)
            : points[0]
              ? points[0].at - bucket / 2
              : now - rangeMilliseconds[range];
    const end = points.length
        ? 2 * points.at(-1)!.at - (start + (points.length - 1) * bucket)
        : typeof range === 'string'
          ? now
          : Math.min(now, Date.parse(range.to));
    const gaps: MissingInterval[] = [];
    for (let i = 0; i < points.length; i++) {
        const point = points[i]!;
        if (point.Upload !== null && point.Download !== null) continue;
        const from = start + i * bucket;
        const to = Math.min(from + bucket, end);
        const previous = gaps.at(-1);
        if (previous?.to === from) previous.to = to;
        else gaps.push({ from, to });
    }
    const last = points.findLast(
        (point) => point.Upload !== null && point.Download !== null,
    );
    if (!points.length) gaps.push({ from: start, to: end });
    return {
        points: points.length
            ? points
            : [
                  { at: start, Upload: null, Download: null },
                  { at: end, Upload: null, Download: null },
              ],
        gaps,
        domain: [start, end] as [number, number],
        status: last
            ? `Average rates in ${bucketSeconds / 60}-minute intervals; timestamps mark interval midpoints.`
            : 'No recorded usage in this time range.',
        latest: last
            ? { upload: last.Upload!, download: last.Download!, at: last.at }
            : null,
    };
}
