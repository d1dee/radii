type HistoricalAccountingSession = {
    acctstarttime: Date | null;
    acctstoptime: Date | null;
    acctupdatetime: Date | null;
    acctinputoctets: number | null;
    acctoutputoctets: number | null;
    isPppoe: boolean;
    capturedOctets: number;
    rangeOctets: number;
};

export function summarizeSessionsInRange(
    rows: HistoricalAccountingSession[],
    from: Date,
    to: Date,
    now = Date.now(),
) {
    const rangeStart = from.getTime();
    const rangeEnd = Math.min(to.getTime(), now);
    let sessions = 0;
    let octets = 0;
    let totalSeconds = 0;
    const sessionsByType = { pppoe: 0, hotspot: 0 };

    for (const row of rows) {
        if (!row.acctstarttime) continue;
        const start = row.acctstarttime.getTime();
        const end = Math.min(row.acctstoptime?.getTime() ?? now, now);
        if (rangeStart > rangeEnd || start > rangeEnd || end < rangeStart)
            continue;
        sessions++;
        sessionsByType[row.isPppoe ? 'pppoe' : 'hotspot']++;
        totalSeconds += Math.max(
            0,
            (Math.min(end, rangeEnd) - Math.max(start, rangeStart)) / 1000,
        );

        const cumulativeOctets =
            Math.max(0, Number(row.acctinputoctets ?? 0)) +
            Math.max(0, Number(row.acctoutputoctets ?? 0));
        const reportedAt = (
            row.acctstoptime ?? row.acctupdatetime ?? row.acctstarttime
        ).getTime();
        // Attribute only the not-yet-captured counter tail to its report time.
        // Never add lifetime counters on top of already captured usage deltas.
        octets += Number(row.rangeOctets);
        if (reportedAt >= rangeStart && reportedAt <= rangeEnd) {
            octets += Math.max(0, cumulativeOctets - Number(row.capturedOctets));
        }
    }

    const rangeSeconds = Math.max(0, (rangeEnd - rangeStart) / 1000);
    return {
        sessions,
        sessionsByType,
        octets,
        averageThroughputBps:
            rangeSeconds > 0 ? Math.round((octets * 8) / rangeSeconds) : 0,
        avgSessionSeconds: sessions > 0 ? totalSeconds / sessions : 0,
    };
}
