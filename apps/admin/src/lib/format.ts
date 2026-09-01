// Display formatting shared by the admin pages.

export function formatMoney(amount: number | string): string {
    const value = typeof amount === 'string' ? Number(amount) : amount;
    return `Ksh ${value.toLocaleString(undefined, {
        maximumFractionDigits: 2,
    })}`;
}

export function formatBytes(octets: number): string {
    if (!Number.isFinite(octets) || octets <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = octets;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${value.toLocaleString(undefined, {
        maximumFractionDigits: value >= 100 ? 0 : 1,
    })} ${units[unit]}`;
}

// Human duration from seconds ("45s", "12m", "3h 24m", "2d 4h").
export function formatSeconds(totalSeconds: number): string {
    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '0s';
    const seconds = Math.round(totalSeconds);
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${secs}s`;
    return `${secs}s`;
}

// Bits per second into a readable rate.
export function formatSpeed(bps: number): string {
    if (!Number.isFinite(bps) || bps <= 0) return '0 Kbps';
    if (bps >= 1_000_000) {
        return `${(bps / 1_000_000).toLocaleString(undefined, {
            maximumFractionDigits: 2,
        })} Mbps`;
    }
    return `${Math.round(bps / 1000).toLocaleString()} Kbps`;
}
