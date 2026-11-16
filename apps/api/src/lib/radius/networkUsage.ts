type OpenAccountingSession = {
    username: string | null;
    acctstarttime: Date | null;
    acctsessiontime: number | null;
    acctinputoctets: number | null;
    acctoutputoctets: number | null;
};

export function summarizeOpenSessions(
    rows: OpenAccountingSession[],
    now = Date.now(),
) {
    let liveOctets = 0;
    let aggregateBps = 0;
    let totalAgeSeconds = 0;
    const users = new Set<string>();

    for (const row of rows) {
        const octets =
            Math.max(0, Number(row.acctinputoctets ?? 0)) +
            Math.max(0, Number(row.acctoutputoctets ?? 0));
        liveOctets += octets;
        if (row.username) users.add(row.username);
        totalAgeSeconds += row.acctstarttime
            ? Math.max(0, (now - row.acctstarttime.getTime()) / 1000)
            : 0;

        // Match cumulative bytes to the NAS-reported duration, not a trailing
        // window or time elapsed since the last accounting update.
        const seconds = Number(row.acctsessiontime ?? 0);
        if (seconds > 0) aggregateBps += (octets * 8) / seconds;
    }

    return {
        liveSessions: rows.length,
        liveUsers: users.size,
        liveOctets,
        aggregateThroughputBps: Math.round(aggregateBps),
        avgSpeedPerSessionBps: rows.length
            ? Math.round(aggregateBps / rows.length)
            : 0,
        avgSessionSeconds: rows.length ? totalAgeSeconds / rows.length : 0,
    };
}
