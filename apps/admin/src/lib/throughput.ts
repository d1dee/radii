import type { ThroughputObservation } from './api';

export type ThroughputPoint = {
    at: number;
    Upload: number | null;
    Download: number | null;
};

export function recordedThroughput(
    observations: ThroughputObservation[],
    now: number,
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
    const end = Math.max(...intervals.map((row) => row.to));
    const start = end - 3_600_000;
    const boundaries = [
        ...new Set(
            intervals.flatMap((row) =>
                row.to > start ? [Math.max(start, row.from), row.to] : [],
            ),
        ),
    ].sort((a, b) => a - b);
    const points: ThroughputPoint[] = [];
    // Split at every recorded interval boundary. Only overlapping intervals are
    // summed; a session's last rate is never carried into another session or gap.
    for (let i = 1; i < boundaries.length; i++) {
        const from = boundaries[i - 1]!;
        const to = boundaries[i]!;
        const overlapping = intervals.filter(
            (row) => row.from < to && row.to > from,
        );
        const Upload = overlapping.length
            ? overlapping.reduce((sum, row) => sum + row.upload, 0)
            : null;
        const Download = overlapping.length
            ? overlapping.reduce((sum, row) => sum + row.download, 0)
            : null;
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
