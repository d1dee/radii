// RADIUS subsystem composition root: builds the singleton RadiusClient from
// env and starts the cumulative time-bank reconciler. Guarded against
// `bun --hot` re-evaluation stacking duplicate clients/timers (same pattern
// as lib/payments and db).

import { env } from '../../env';
import { RadiusClient } from './client';

function buildRadiusClient(): RadiusClient {
    return new RadiusClient({
        serverUrl: env.radius.url,
        secret: env.radius.secret,
        dmPort: env.radius.dmPort,
        coaPort: env.radius.coaPort,
        timeoutMs: env.radius.timeoutMs,
        retries: env.radius.retries,
        bankInterimSeconds: env.radius.bankInterimSeconds,
    });
}

const globalRef = globalThis as unknown as {
    __radiusClient?: RadiusClient;
    __radiusBankTicker?: ReturnType<typeof setInterval>;
};
export const radiusClient: RadiusClient =
    globalRef.__radiusClient ??
    (globalRef.__radiusClient = buildRadiusClient());

if (!env.radius.url) {
    console.warn(
        '[radius] RADIUS_SERVER is not configured; provisioning still writes the RADIUS SQL tables but direct RADIUS packets (credential checks, disconnects via this server) are disabled.',
    );
}

// Cumulative time-bank reconciler: keeps Session-Timeout caps on live bank
// sessions in step with their consumed balance and cuts exhausted/expired
// ones. Bank balance enforcement at login time is handled by the radreply
// Session-Timeout refresh on every redirect + the radcheck Expiration date;
// the ticker is what closes the gap DURING live sessions.
const tickerSeconds = Math.max(5, env.radius.bankReconcileSeconds);
if (!globalRef.__radiusBankTicker) {
    globalRef.__radiusBankTicker = setInterval(() => {
        void radiusClient
            .reconcileBankPackages()
            .catch((err) =>
                console.error('[radius] bank reconciliation tick failed:', err),
            );
    }, tickerSeconds * 1000);
    // Never hold the event loop open for the ticker alone (tests/scripts).
    if (typeof globalRef.__radiusBankTicker.unref === 'function') {
        globalRef.__radiusBankTicker.unref();
    }
}

export {
    parseRadiusServerUrl,
    RADIUS_CONSTANTS,
    RadiusClient,
    RadiusError,
} from './client';
export type {
    ActivationRedirect,
    ActivationStatus,
    NetworkUsage,
    RadiusConfig,
    RadiusInAttribute,
    RadiusOutAttribute,
    RadiusReply,
    SessionInfo,
} from './client';
