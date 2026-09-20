export function timeRemaining(totalSeconds: number) {
    let remaining = Math.max(0, Math.floor(totalSeconds));
    const units = [
        ['week', 7 * 24 * 60 * 60],
        ['day', 24 * 60 * 60],
        ['hour', 60 * 60],
        ['minute', 60],
        ['second', 1],
    ] as const;
    const parts: string[] = [];

    for (const [label, seconds] of units) {
        const value = Math.floor(remaining / seconds);
        if (value > 0) {
            parts.push(`${value} ${label}${value === 1 ? '' : 's'}`);
            remaining %= seconds;
        }
        if (parts.length === 2) break;
    }

    return parts.join(' ') || '0 seconds';
}
