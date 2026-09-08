// Shared auto-refresh cadence for every console page. The interval comes from
// the admin's own settings (Settings -> Dashboard -> refresh seconds) so all
// data pages update at the cadence the operator configured.

import { useEffect } from 'react';

import { useAdminSettings } from '@/lib/settings';

/**
 * Calls `callback` on the admin's configured refresh cadence.
 *
 * - Waits until settings finished loading so the saved value (not the
 *   default) drives the timer.
 * - Skips ticks while the tab is hidden to avoid pointless background
 *   requests; the next visible tick refreshes the data.
 * - Set `enabled` to false to pause (e.g. a manual auto-refresh switch).
 */
export function useAutoRefresh(callback: () => void, enabled = true) {
    const { settings, loaded } = useAdminSettings();
    const seconds = settings.dashboard.usageRefreshSeconds;

    useEffect(() => {
        if (!loaded || !enabled) return;
        const timer = setInterval(() => {
            if (document.visibilityState === 'visible') callback();
        }, seconds * 1000);
        return () => clearInterval(timer);
    }, [callback, enabled, loaded, seconds]);
}
