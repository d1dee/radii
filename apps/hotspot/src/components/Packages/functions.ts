import type { Dispatch, SetStateAction } from 'react';
import type { Quota } from '../../types/index.ts';
import { dayjs } from '../../lib/dayjs.ts';
import { currentLoginRequestId, getStatus } from '../../lib/api.ts';

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

export async function checkQuotaStatus(
    setValue: Dispatch<SetStateAction<Partial<Quota> & { width: string }>>,
) {
    try {
        const result = await getStatus(currentLoginRequestId());
        if (!result.success || !result.data) return;

        // Pick the highest if no token belongs to this devices
        const deviceQuota =
            result.data.find((v) => v.thisDevice) || result.data[0];

        setValue((prev) => ({
            ...prev,
            ...deviceQuota,
            width:
                Math.max(
                    0,
                    Math.min(
                        100,
                        (dayjs
                            .duration(prev?.remainingSessionLength || 0, 'm')
                            .asSeconds() *
                            100) /
                            dayjs
                                .duration(prev?.sessionLength || 0, 'm')
                                .asSeconds(),
                    ),
                ) + '%',
            sessionLength: dayjs
                .duration(deviceQuota?.sessionLength || 0, 'm')
                .asSeconds(),
            remainingSessionLength: dayjs
                .duration(deviceQuota?.remainingSessionLength || 0, 'm')
                .asSeconds(),
        }));

        return result.data;
    } catch (err) {
        console.warn('Error checking package status', err);
    }
}

export async function checkOnlineStatus() {
    try {
        const abort = new AbortController();
        // timeout out 5 seconds
        const timeoutId = setTimeout(
            () => abort.abort('Request timed out.'),
            5e3,
        );

        const res = await fetch('https://catfact.ninja/fact', {
            method: 'GET',
            cache: 'no-store',
            signal: abort.signal,
        });

        console.log('Random cat ping fact: ', (await res.json())?.fact);
        clearTimeout(timeoutId);

        return res.status === 200;
    } catch (err) {
        console.warn('Error checking online status', err);
        return false;
    }
}
