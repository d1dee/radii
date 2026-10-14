const durationUnits = [
    ['month', 30 * 24 * 60 * 60],
    ['week', 7 * 24 * 60 * 60],
    ['day', 24 * 60 * 60],
    ['hour', 60 * 60],
    ['minute', 60],
    ['second', 1],
] as const;

export function formatDuration(totalSeconds: number, noExpiry = false): string {
    if (noExpiry) return 'Unlimited';
    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '0 seconds';

    // Duration months use the same 30-day convention as package configuration.
    const [label, seconds] =
        durationUnits.find(([, seconds]) => totalSeconds >= seconds) ??
        durationUnits[durationUnits.length - 1]!;
    const value = Math.max(0.1, Math.round((totalSeconds / seconds) * 10) / 10);
    return `${value} ${label}${value === 1 ? '' : 's'}`;
}
