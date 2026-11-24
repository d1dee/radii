export function reportRevenueBuckets(from: Date, to: Date) {
    const duration = to.getTime() - from.getTime();
    const minute = 60_000;
    const hour = 60 * minute;
    const day = 24 * hour;
    const unit = duration <= hour ? 'minute'
        : duration <= 2 * day ? 'hour'
        : duration <= 56 * day ? 'day' : 'week';
    const bucketMs = { minute, hour, day, week: 7 * day }[unit];
    return {
        unit,
        bucketMs,
        // Ranges are inclusive; each bucket starts at the selected range origin.
        items: Array.from({ length: Math.floor(duration / bucketMs) + 1 }, (_, i) => ({
            start: new Date(from.getTime() + i * bucketMs).toISOString(),
            hotspot: 0,
            pppoe: 0,
        })),
    };
}
