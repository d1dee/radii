import type { Dispatch, SetStateAction } from 'react';
import type { Quota } from '../../types/index.ts';
import { dayjs } from '../../lib/dayjs.ts';
import { currentLoginRequestId, getStatus } from '../../lib/api.ts';

export function timeRemaining(duration: ReturnType<typeof dayjs.duration>) {
    return duration
        .format(
            'YYYY [year]-MM [month]-DD [day]-HH [hour]-mm [minute]-ss [second]',
        )
        .replace(/(?:\s|-){0,}(?:0{2,}\s[a-z]+)/g, '')
        .split('-')
        .map((v: string) => {
            const duration = Number(v.split(' ')[0] || 0);

            if (duration > 7 && v.split(' ')[1] === 'day') {
                return `${Math.floor(duration)} week${Math.floor(duration) > 1 ? 's' : ''} ${
                    duration % 7 == 0
                        ? ''
                        : `${duration % 7} day${duration % 7 > 1 ? 's' : ''}`
                }`;
            }
            return duration === 0 ? '' : duration > 1 ? v + 's' : v;
        })
        .join(' ');
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
