import { STATUS_TEXT, StatusCode } from '$std/http/status.ts';

import dayjs from 'https://esm.sh/dayjs';
import duration from 'https://esm.sh/dayjs/plugin/duration';
import relativeTime from 'https://esm.sh/dayjs/plugin/relativeTime';
import timezone from 'https://esm.sh/dayjs/plugin/timezone';
import utc from 'https://esm.sh/dayjs/plugin/utc';
import { writeLog } from './log.ts';
import { renderError } from './renderError.ts';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(duration);
dayjs.extend(relativeTime);
dayjs.tz.setDefault('Africa/Nairobi');

export { dayjs };

export function shortId(length = 8): string {
    const chars =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    return Array.from(array, (byte) => chars[byte % chars.length]).join('');
}

export function upperFirstCase(s: string) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

export function JSONResponse(
    data: { success: boolean; message: string; data?: unknown },
    status?: StatusCode,
) {
    try {
        const response = new Response(JSON.stringify(data), {
            status: status,
            statusText: STATUS_TEXT[status || data.success ? 200 : 500],
            headers: { 'content-type': 'application/json' },
        });
        return response;
    } catch (err) {
        writeLog().warn(
            'Error while trying to send JSONResponse',
            err as Error,
        );
        return renderError({
            status: 500,
            message: 'Error: return JSON response',
        });
    }
}
