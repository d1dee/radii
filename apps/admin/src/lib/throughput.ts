import type { ThroughputObservation, ThroughputRange } from './api';

export type ThroughputPoint = {
    at: number;
    Upload: number | null;
    Download: number | null;
};

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
    const end = intervals.reduce(
        (latest, row) => Math.max(latest, row.to),
        -Infinity,
    );
    const start = end - {
        hour: 3_600_000,
        day: 86_400_000,
        month: 30 * 86_400_000,
    }[range];
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
        // One sample per interval avoids duplicate timestamps and vertical steps.
        // Keep the outer boundaries so the full recorded time range is visible.
        if (i === 1) points.push({ at: from, Upload, Download });
        points.push({ at: from + (to - from) / 2, Upload, Download });
        if (i === boundaries.length - 1) points.push({ at: to, Upload, Download });
    }
    const last = points.at(-1);
    return {
        points,
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
