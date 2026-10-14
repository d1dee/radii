import humanFormat from 'human-format';
export { formatDuration as timeRemaining } from '@radii/shared';

export const dataScale = new humanFormat.Scale({
    Kbps: 1,
    Mbps: 1e3,
    Gbps: 1e6,
});

export function formatPackageRate(rate: number | null | undefined) {
    return rate == null || rate === 0
        ? 'Unlimited'
        : humanFormat(rate, { scale: dataScale });
}

export function formatPackagePrice(price: number) {
    return price === 0 ? 'Free' : `Ksh ${price.toLocaleString()}`;
}
