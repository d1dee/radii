// Display formatting shared by the admin pages. Date/time and currency
// rendering follow the signed-in admin's appearance settings (Settings page);
// until they load, the defaults below apply.

import type { AdminSettings } from '@shared/index';
import type { ConfigType } from 'dayjs';
import { dayjs } from './dayjs';

const defaultAppearance: AdminSettings['appearance'] = {
    timeFormat: '24h',
    dateFormat: 'DD MMM YYYY',
    timezone: 'Africa/Nairobi',
    currencyLabel: 'Ksh',
};

let appearance: AdminSettings['appearance'] = defaultAppearance;

// Called by the SettingsProvider whenever per-admin settings (re)load.
export function configureAppearance(
    settings: AdminSettings['appearance'],
): void {
    appearance = settings;
    dayjs.tz.setDefault(settings.timezone);
}

function timeToken(withSeconds = false): string {
    if (appearance.timeFormat === '12h')
        return withSeconds ? 'h:mm:ss A' : 'h:mm A';
    return withSeconds ? 'HH:mm:ss' : 'HH:mm';
}

// Date only, in the admin's chosen format and timezone.
export function formatDate(value: ConfigType): string {
    return dayjs(value).tz(appearance.timezone).format(appearance.dateFormat);
}

// Date + time of day (12h/24h per settings).
export function formatDateTime(value: ConfigType): string {
    return dayjs(value)
        .tz(appearance.timezone)
        .format(`${appearance.dateFormat} ${timeToken()}`);
}

// Day + time without the year (compact table cells).
export function formatDayTime(value: ConfigType): string {
    return dayjs(value).tz(appearance.timezone).format(`D MMM ${timeToken()}`);
}

export function formatTime(value: ConfigType, withSeconds = false): string {
    return dayjs(value).tz(appearance.timezone).format(timeToken(withSeconds));
}

// Renders a sample with an arbitrary appearance config (settings-page
// previews), without touching the active configuration.
export function previewDateTime(
    value: ConfigType,
    candidate: AdminSettings['appearance'],
): string {
    return dayjs(value)
        .tz(candidate.timezone)
        .format(
            `${candidate.dateFormat} ${candidate.timeFormat === '12h' ? 'h:mm A' : 'HH:mm'}`,
        );
}

export function formatMoney(amount: number | string): string {
    const value = typeof amount === 'string' ? Number(amount) : amount;
    return `${appearance.currencyLabel} ${value.toLocaleString(undefined, {
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
