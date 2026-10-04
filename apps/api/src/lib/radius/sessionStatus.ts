import type { radacct } from '../../db/schema';
import type { SessionInfo } from './client';

// Presentation only: an acknowledged live timeout never renews the package.
export function portalStatusIsVisible(
    status: {
        deactivated: boolean;
        bankTotalSeconds?: number | null;
        expireAt?: Date;
        liveSessions: (Pick<SessionInfo, 'live' | 'remainingSeconds'> & Partial<Pick<SessionInfo, 'bonusRemainingSeconds'>>)[];
    },
    normallyAvailable: boolean,
): boolean {
    return (
        normallyAvailable ||
        (!status.deactivated &&
            (status.bankTotalSeconds == null || (status.expireAt !== undefined && status.expireAt.getTime() > Date.now())) &&
            status.liveSessions.some(
                (session) => session.live && (status.bankTotalSeconds != null
                    ? (session.bonusRemainingSeconds ?? 0) > 0
                    : (session.remainingSeconds ?? 0) > 0),
            ))
    );
}

export function sessionRemainingSeconds(
    row: Pick<
        typeof radacct.$inferSelect,
        'acctstarttime' | 'acctstoptime' | 'sessionTimeoutExpiresAt'
    >,
    now = Date.now(),
): number | null {
    if (
        row.acctstarttime === null ||
        row.acctstoptime !== null ||
        row.sessionTimeoutExpiresAt === null
    ) {
        return null;
    }
    return Math.max(
        0,
        Math.ceil((row.sessionTimeoutExpiresAt.getTime() - now) / 1000),
    );
}

// Compare colon-separated, hyphen-separated and compact MAC addresses.
export function normalizeMac(mac: string | null | undefined): string {
    return (mac ?? '').toLowerCase().replace(/[^0-9a-f]/g, '');
}

export function currentDeviceSessionId(
    sessions: Pick<SessionInfo, 'radacctId' | 'callingStationId' | 'live'>[],
    clientMac: string,
): string | null {
    const normalizedMac = normalizeMac(clientMac);
    if (!normalizedMac) return null;
    return (
        sessions.find(
            (session) =>
                session.live &&
                normalizeMac(session.callingStationId) === normalizedMac,
        )?.radacctId ?? null
    );
}
