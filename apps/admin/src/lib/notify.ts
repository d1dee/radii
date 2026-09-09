import { notifications } from '@mantine/notifications';
import type { ApiEnvelope } from '@shared/index';

// Toast for an API action result: the success message comes from the payload
// (`data.message` when present, otherwise the caller's fallback), the failure
// message from the envelope error half.
export function notifyResult<T>(res: ApiEnvelope<T>, fallback: string) {
    let dataMessage: string | undefined;
    if (res.success && res.data && typeof res.data === 'object') {
        const candidate = (res.data as { message?: unknown }).message;
        if (typeof candidate === 'string') dataMessage = candidate;
    }
    notifications.show({
        color: res.success ? 'green' : 'red',
        message: res.success ? (dataMessage ?? fallback) : res.message,
    });
}
