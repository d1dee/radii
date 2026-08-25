// Shared hotspot domain types — consumed by both the API and the hotspot SPA.

export type Package = {
    packageId: string;
    title: string;
    category: string;
    sessionLength: number; // minutes
    price: number;
    maxDevices: number;
    noExpiry: boolean;
    note?: string;
    description?: string;
    uploadRate: number; // Kbps
    downloadRate: number; // Kbps
    downloadQuota: number; // KB
    uploadQuota: number; // KB
};

// A single device-quota entry returned by the status endpoint.
export type Quota = {
    remainingSessionLength: number;
    sessionLength: number;
    deviceQuotaId: string;
    lastActive?: string;
    ndsToken?: string;
    clientMac?: string;
    price: number;
    uploadRate: number;
    downloadRate: number;
    maxDevices: number;
    parentQuotaId: string;
    thisDevice?: boolean;
    expiresAt?: string;
    online?: boolean;
    packageId?: string;
    packageTitle?: string;
    username?: string;
    usedSeconds?: number;
    sessionLimitSeconds?: number;
    octetsUsed?: number;
    octetsLimit?: number | null;
    remainingOctets?: number | null;
    avgSpeedBps?: number;
    // Cumulative time-bank packages (noExpiry): total/used/remaining bank
    // seconds within the static validity window. Null for regular packages.
    bankTotalSeconds?: number | null;
    bankUsedSeconds?: number | null;
    bankRemainingSeconds?: number | null;
    liveSessions?: Array<{
        radacctId: string;
        acctSessionId: string;
        username: string;
        nasIpAddress: string;
        callingStationId: string | null;
        framedIpAddress: string | null;
        startedAt: Date | string | null;
        updatedAt: Date | string | null;
        stoppedAt: Date | string | null;
        live: boolean;
        seconds: number;
        inputOctets: number;
        outputOctets: number;
        totalOctets: number;
        terminateCause: string | null;
        avgSpeedBps: number;
    }>;
};

// Everything the portal needs for the final activation hop: submitting the
// freshly issued hotspot credentials to the NAS servlet login page.
export type ActivationRedirect = {
    activationId: string;
    username: string;
    password: string;
    linkLoginOnly: string;
    dst: string;
    mac: string;
    chapId?: string;
    chapChallenge?: string;
};

export type Session = {
    expiresAt: number;
    sessionKey?: string;
};

export type Packages = Array<[string, Array<Package>]>;

// Aggregated page payload consumed by the main hotspot component.
export interface MainPageProps {
    initPackageId?: string;
    session?: Session;
}
