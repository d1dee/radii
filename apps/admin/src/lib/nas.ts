import {
    nasDeviceStatuses,
    upperFirstCase,
    type NasDeviceOs,
    type NasDeviceStatus,
} from '@shared/index';

// Display metadata for NAS device OSes. Add new platforms here as support
// expands beyond MikroTik RouterOS.
const NAS_DEVICE_OS_LABELS: Record<NasDeviceOs, string> = {
    routeros: 'MikroTik RouterOS',
};

export const nasDeviceOsOptions = (
    Object.entries(NAS_DEVICE_OS_LABELS) as Array<[NasDeviceOs, string]>
).map(([value, label]) => ({ value, label }));

export function nasDeviceOsLabel(os: unknown): string {
    return (
        NAS_DEVICE_OS_LABELS[os as NasDeviceOs] ??
        (typeof os === 'string' && os ? os : 'Unknown')
    );
}

export const nasDeviceStatusOptions = nasDeviceStatuses.map((status) => ({
    value: status,
    label: upperFirstCase(status),
}));

export const nasDeviceStatusColors: Record<NasDeviceStatus, string> = {
    active: 'green',
    inactive: 'gray',
    maintenance: 'orange',
    offline: 'red',
};
