// Shared hotspot domain types — consumed by both the API and the hotspot SPA.

export type Package = {
    packageId: string;
    title: string;
    category: string;
    initialSessionLength: number; // minutes
    price: number;
    maxDevices: number;
    noExpiry: boolean;
    note?: string;
    description?: string;
    uploadRate: number; // Kbps
    downloadRate: number; // Kbps
    downloadQuota: number; // KB
    uploadQuota: number; // KB
    gateway?: string;
};

// A single device-quota entry returned by the status endpoint.
export type StatusQuota = {
    remainingSessionLength: number;
    initialSessionLength: number;
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

export type StatusQuotas = StatusQuota[];

export type Client = {
    userId: string;
    phoneNumber: string;
    prevPaymentMethods: string[];
};

export type Session = {
    expiresAt: number;
    sessionKey?: string;
};

// Aggregated page payload consumed by the main hotspot component.
export interface MainPageProps {
    dbPackages: Array<[string, Array<Package>]>;
    initPackageId?: string;
    session?: Session;
    client?: Client;
    quotas: StatusQuotas | undefined;
}
