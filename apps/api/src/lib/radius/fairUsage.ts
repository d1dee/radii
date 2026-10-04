export function manualFairUsageAvailable(pkg: {
    fairUsageLimit: number;
    fairUsageUploadRate: number;
    fairUsageDownloadRate: number;
}): boolean {
    return (
        Number.isFinite(pkg.fairUsageLimit) &&
        pkg.fairUsageLimit > 0 &&
        Number.isFinite(pkg.fairUsageUploadRate) &&
        Number.isFinite(pkg.fairUsageDownloadRate) &&
        pkg.fairUsageUploadRate >= 0 &&
        pkg.fairUsageDownloadRate >= 0 &&
        (pkg.fairUsageUploadRate > 0 || pkg.fairUsageDownloadRate > 0)
    );
}

export function effectiveFairUsageThrottled(
    automatic: boolean,
    forced: boolean,
): boolean {
    return automatic || forced;
}
