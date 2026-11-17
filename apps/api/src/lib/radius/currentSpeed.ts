export type SpeedObservation = {
    observedAt: Date;
    intervalStartedAt: Date;
    inputOctets: number;
    outputOctets: number;
    accountingUpdatedAt: Date;
    accountingInterval: number | null;
};

/** Combined upload/download bits per second over the last stored interval. */
export function currentSpeedBps(
    observation: SpeedObservation | undefined,
    now = Date.now(),
): number | null {
    if (!observation) return null;
    const end = observation.observedAt.getTime();
    const start = observation.intervalStartedAt.getTime();
    const updated = observation.accountingUpdatedAt.getTime();
    const { inputOctets, outputOctets } = observation;
    // Allow three accounting periods, with room for the 60-second ledger job.
    // A newer accounting update without a delta is not evidence of zero traffic.
    const maxAge = Math.max(180_000, (observation.accountingInterval ?? 0) * 3000);
    if (
        ![start, end, updated, inputOctets, outputOctets, maxAge].every(Number.isFinite) ||
        end <= start || end > now || now - end > maxAge || updated > end ||
        inputOctets < 0 || outputOctets < 0
    ) return null;
    const speed = ((inputOctets + outputOctets) * 8000) / (end - start);
    return Number.isFinite(speed) ? Math.round(speed) : null;
}
