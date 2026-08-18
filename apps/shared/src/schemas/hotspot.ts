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
