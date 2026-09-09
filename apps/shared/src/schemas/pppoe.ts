// Shared PPPoE domain types — consumed by both the API and the PPPoE SPA.
//
// Unlike hotspot, PPPoE has no captive-portal redirect hop: the NAS dials the
// RADIUS-provisioned credentials directly (RouterOS authenticates ppp service
// logins via RADIUS). The deliverable of a purchase is therefore the dialer
// credentials plus the client configuration needed to set up the PPPoE dialer.

// Credentials issued for one activation; the equivalent of hotspot's
// ActivationRedirect minus the servlet link.
export type PppoeActivation = {
    activationId: string;
    username: string;
    password: string;
};

// Service-level dialer defaults the portal shows to every customer (the NAS
// PPPoE server accepts any service name when none is configured).
export type PppoeServiceConfig = {
    serviceName: string;
    mtu: number;
    mru: number;
    dns: string[];
};

// One PPPoE dialer account of the current user: an active activation with the
// credentials to configure on the customer's router/phone dialer.
export type PppoeClient = PppoeActivation & {
    packageTitle: string;
    activatedAt: string;
    expireAt: string;
    // The dialer holds an established PPP session right now.
    online: boolean;
};

// Everything needed to configure one dialer: credentials + service config.
export type PppoeClientConfig = PppoeActivation &
    PppoeServiceConfig & {
        packageTitle: string;
        expireAt: string;
    };

export type PppoeOrderResult = {
    paymentId: string;
    status: 'pending' | 'paid' | 'failed';
    amount: number;
    packageId: string;
    // Present once the payment is paid and its package was activated on the
    // RADIUS side — the portal displays these dialer credentials.
    activation?: PppoeActivation | null;
};
