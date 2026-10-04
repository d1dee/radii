import { createHmac } from 'node:crypto';

export const NAS_MONITORING_USERNAME = 'radii-monitor';

export function deriveNasMonitoringPassword(
    nasDeviceId: string,
    radiusSecret: string,
    serverSecret: string,
): string {
    return createHmac('sha256', serverSecret)
        .update(JSON.stringify(['radii-nas-monitor-v1', nasDeviceId, radiusSecret]))
        .digest('hex');
}
