// RADIUS integration: one class covering the whole backend <-> RADIUS surface.
//
// What it does and why (sources of truth, per project policy — no behaviour
// here is assumed beyond these documents):
//
//  * MikroTik RouterOS manual — RADIUS page: the NAS authenticates hotspot
//    users against the RADIUS server (radcheck/radreply provisioning), honours
//    Access-Accept attributes Session-Timeout, Port-Limit (overrides
//    shared-users), Class (cookie echoed unchanged into accounting),
//    Mikrotik-Rate-Limit ("rx/tx k|M" format, rx = client upload), and
//    Mikrotik-Total-Limit (+Gigawords) for byte quotas. Sessions are
//    terminated from the RADIUS side via Disconnect-Messages accepted on the
//    router's `/radius/incoming` (default port 1700; RouterOS does NOT
//    support PoD). CoA can live-change rate limits/timeouts/Port-Limit.
//  * MikroTik RouterOS manual — HotSpot page: hotspot logs users in through
//    its servlet login page (http-chap by default); the portal re-submits
//    issued credentials to $(link-login-only) as the final activation hop.
//  * FreeRADIUS: the SQL backend (radcheck check-attributes, radreply
//    reply-attributes) is how consumers manage users on this server, and the
//    radacct table is where accounting lands. `Expiration` in radcheck is
//    enforced by the stock `expiration` module.
//  * RFC 2865 (Access packets, PAP User-Password encryption, response
//    authenticator), RFC 2866 (accounting), RFC 3576 / RFC 5176
//    (Disconnect-Request / CoA-Request: zero-authenticator request signing,
//    mandatory Message-Authenticator).
//
// Direct packet targets:
//  - credential checks are Access-Requests to the RADIUS SERVER
//    (env RADIUS_SERVER/RADIUS_SECRET).
//  - session termination (RFC 5176 Disconnect-Request) and re-authorization
//    (CoA-Request) go DIRECTLY to the NAS on its `/radius/incoming` listener
//    (dmPort, RouterOS default 1700), signed with the per-NAS shared secret
//    from nas_setup_script. The session's NAS-IP-Address (radacct) resolves
//    the device — matching the WireGuard tunnel address
//    (nas_setup_script.wg_client_ip) or nas_device.ip_address — so the same
//    lookup works for other NAS models as long as they expose their identity
//    in the DB. Requests are identified by Acct-Session-Id + User-Name.

import dayjs from 'dayjs';
import {
    and,
    desc,
    eq,
    getTableColumns,
    gte,
    isNotNull,
    isNull,
    ne,
    or,
    sql,
} from 'drizzle-orm';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import * as dgram from 'node:dgram';
import { radiusClient } from '.';
import { db } from '../../db';
import {
    activatedPackages,
    hotspotLoginRequest,
    nasDevice,
    nasSetupScript,
    packagePayments,
    packages,
    radacct,
    radcheck,
    radreply,
    transaction,
    user,
} from '../../db/schema';

export class RadiusError extends Error {
    constructor(
        message: string,
        public readonly detail?: unknown,
    ) {
        super(message);
        this.name = 'RadiusError';
    }
}

// --- RADIUS protocol constants (RFC 2865/2866/3576/5176) ---------------------

const CODE = {
    ACCESS_REQUEST: 1,
    ACCESS_ACCEPT: 2,
    ACCESS_REJECT: 3,
    ACCOUNTING_REQUEST: 4,
    ACCOUNTING_RESPONSE: 5,
    DISCONNECT_REQUEST: 40,
    DISCONNECT_ACK: 41,
    DISCONNECT_NAK: 42,
    COA_REQUEST: 43,
    COA_ACK: 44,
    COA_NAK: 45,
} as const;

// Attribute types the api originates or inspects.
const ATTR = {
    USER_NAME: 1,
    USER_PASSWORD: 2,
    NAS_IP_ADDRESS: 4,
    SERVICE_TYPE: 6,
    FRAMED_IP_ADDRESS: 8,
    REPLY_MESSAGE: 18,
    CLASS: 25,
    VENDOR_SPECIFIC: 26,
    SESSION_TIMEOUT: 27,
    IDLE_TIMEOUT: 28,
    CALLED_STATION_ID: 30,
    CALLING_STATION_ID: 31,
    NAS_IDENTIFIER: 32,
    ACCT_STATUS_TYPE: 40,
    ACCT_INPUT_OCTETS: 42,
    ACCT_OUTPUT_OCTETS: 43,
    ACCT_SESSION_ID: 44,
    ACCT_SESSION_TIME: 46,
    ACCT_TERMINATE_CAUSE: 49,
    ACCT_INPUT_GIGAWORDS: 52,
    ACCT_OUTPUT_GIGAWORDS: 53,
    EVENT_TIMESTAMP: 55,
    PORT_LIMIT: 62,
    ACCT_INTERIM_INTERVAL: 85,
    MESSAGE_AUTHENTICATOR: 80,
} as const;

// Mikrotik vendor-specific attributes (vendor 14988, RouterOS RADIUS page).
const MIKROTIK_VENDOR_ID = 14988;
const MIKROTIK_ATTR = {
    RECV_LIMIT: 1,
    XMIT_LIMIT: 2,
    GROUP: 3,
    RATE_LIMIT: 8,
    TOTAL_LIMIT: 17,
    TOTAL_LIMIT_GIGAWORDS: 18,
} as const;

export const RADIUS_CONSTANTS = {
    CODE,
    ATTR,
    MIKROTIK_VENDOR_ID,
    MIKROTIK_ATTR,
};

const GIGAWORD = 2 ** 32;
const ZERO_AUTH = Buffer.alloc(16);
const CREDENTIAL_CHARS =
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export interface RadiusConfig {
    // RADIUS server, e.g. "radius://127.0.0.1" or "10.99.0.1:1812" (auth port
    // defaults to 1812 when omitted). Empty disables direct-to-server packets.
    serverUrl: string;
    // Shared secret the RADIUS server knows this api by; signs every packet
    // the backend originates (Access-Requests, CoA-Requests).
    secret: string;
    // The NAS `/radius/incoming` port where this backend delivers
    // Disconnect-Requests / CoA-Requests directly to the router
    // (RouterOS default 1700).
    dmPort: number;
    timeoutMs: number;
    retries: number;
    // Cumulative time-bank (noExpiry) packages: Acct-Interim-Interval pushed
    // to the NAS so bank accounting stays fresh between reconciles.
    bankInterimSeconds: number;
}

type AttributeValue = number | string | Uint8Array;

export interface RadiusOutAttribute {
    type: number;
    value: AttributeValue;
    // Set for vendor-specific attributes (wrapped in a VSA TLV).
    vendor?: number;
}

export interface RadiusInAttribute {
    type: number;
    vendor?: number;
    data: Uint8Array;
}

export interface RadiusReply {
    code: number;
    attributes: RadiusInAttribute[];
}

// JSON attribute payload an rlm_rest (FreeRADIUS 3.x) authorize response
// returns: keys carry the list qualifier (reply:<attribute>), values follow
// the documented { op, value } form with one array entry per instance.
// (FreeRADIUS 4.x switched the qualifier syntax to reply.<attribute>.)
export interface RadiusRestReply {
    [listQualifiedAttribute: string]: {
        op: string;
        value: Array<string | number>;
    };
}

// Everything the portal needs to perform the final hop: submitting the issued
// hotspot credentials to the NAS servlet login page ($(link-login-only)).
export interface ActivationRedirect {
    activationId: string;
    username: string;
    password: string;
    linkLoginOnly: string;
    dst: string;
    mac: string;
    // CHAP challenge issued by the servlet when the login page was served.
    // When present the portal must submit hexMD5(chapId + password +
    // chapChallenge) instead of the plaintext password (http-chap login).
    chapId: string;
    chapChallenge: string;
}

export interface SessionInfo {
    radacctId: string;
    // The NAS-issued Acct-Session-Id (RFC 2866), needed to address
    // Disconnect-Messages at a specific session.
    acctSessionId: string;
    username: string;
    nasIpAddress: string;
    callingStationId: string | null;
    framedIpAddress: string | null;
    startedAt: Date | null;
    updatedAt: Date | null;
    stoppedAt: Date | null;
    live: boolean;
    seconds: number;
    inputOctets: number;
    outputOctets: number;
    totalOctets: number;
    terminateCause: string | null;
    // Average speed across the session's lifetime so far (closed sessions use
    // their final counters).
    avgSpeedBps: number;
}

// Credentials of one provisioned activation (the shared shape returned by the
// provisioning/credential flows of both the hotspot and PPPoE portals).
export interface ProvisionedCredentials {
    activationId: string;
    username: string;
    password: string;
}

export interface ActivationStatus {
    activationId: string;
    username: string;
    packageId: string;
    packageTitle: string;
    paymentId: string;
    activatedAt: Date;
    expireAt: Date;
    expired: boolean;
    sessionLimitSeconds: number;
    usedSeconds: number;
    // Bank packages report the remaining CUMULATIVE balance here; regular
    // packages the remaining per-session allowance.
    remainingSeconds: number | null;
    octetsUsed: number;
    octetsLimit: number | null; // null = unlimited
    remainingOctets: number | null;
    online: boolean;
    liveSessions: SessionInfo[];
    avgSpeedBps: number;
    lastActive: Date | null;
}

// ActivationStatus enriched with ownership info for admin listings, which
// span every user and package type (the portal shapes are single-user).
export interface AdminActivationStatus extends ActivationStatus {
    userId: string;
    packageType: 'hotspot' | 'pppoe';
    noExpiry: boolean;
    maxDevices: number;
}

export interface NetworkUsage {
    windowMinutes: number;
    liveSessions: number;
    liveUsers: number;
    liveOctets: number;
    // Sum of per-live-session throughput: what the currently online user base is
    // transferring right now, averaged over the window (radacct interim
    // updates keep the counters current between Start/Stop records).
    aggregateThroughputBps: number;
    // Mean of the per-session averages over the window.
    avgSpeedPerSessionBps: number;
    sessionsStartedInWindow: number;
    avgSessionSeconds: number;
    topUsers: Array<{ username: string; octets: number; sessions: number }>;
}

function randomCredentialPassword(length: number): string {
    const bytes = randomBytes(length);
    return Array.from(
        bytes,
        (b) => CREDENTIAL_CHARS[b % CREDENTIAL_CHARS.length]!,
    ).join('');
}

// Activation id -> hotspot username, deterministic so re-activation of the
// same payment always maps to the same RADIUS user.
function activationUsername(activationId: string): string {
    return `PK-${activationId.replace(/-/g, '').slice(0, 10).toUpperCase()}`;
}

// User id -> STABLE PPPoE username: one constant RADIUS account per customer,
// reused across every PPPoE package they buy (credentials are only generated
// the first time, see ensurePppoeProvisioned).
function pppoeUsername(userId: string): string {
    const compact = userId.replace(/[^a-zA-Z0-9]/g, '');
    return `PPP-${compact.slice(0, 10).toUpperCase()}`;
}

function attrToOctets(value: AttributeValue): Uint8Array {
    if (typeof value === 'number') {
        const buf = Buffer.alloc(4);
        buf.writeUInt32BE(value >>> 0, 0);
        return buf;
    }
    if (typeof value === 'string') return new TextEncoder().encode(value);
    return value;
}

function attrToInt(data: Uint8Array): number {
    if (data.length < 4) return 0;
    return Buffer.from(data).readUInt32BE(0);
}

function attrToString(data: Uint8Array): string {
    return new TextDecoder().decode(data);
}

// Encodes a dotted-quad as the 4 octets an ipaddr attribute (NAS-IP-Address)
// needs on the wire.
function ipv4ToOctets(ip: string): Uint8Array {
    const parts = ip.split('.').map((p) => Number.parseInt(p, 10));
    if (
        parts.length !== 4 ||
        parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)
    ) {
        throw new RadiusError(`Invalid IPv4 address for NAS-IP-Address: ${ip}`);
    }
    return Uint8Array.from(parts);
}

export function parseRadiusServerUrl(raw: string): {
    host: string;
    port: number;
} {
    const trimmed = raw.trim();
    if (!trimmed) {
        throw new RadiusError(
            'RADIUS_SERVER is not configured; direct RADIUS packets are disabled.',
        );
    }
    const withoutScheme = trimmed.replace(/^(radius|udp):\/\//i, '');
    const [host, portRaw] = withoutScheme.split(':');
    if (!host) {
        throw new RadiusError(`Invalid RADIUS_SERVER "${raw}"`);
    }
    const port = portRaw ? Number.parseInt(portRaw, 10) : 1812;
    if (!Number.isFinite(port) || port <= 0 || port > 65535) {
        throw new RadiusError(`Invalid RADIUS_SERVER port in "${raw}"`);
    }
    return { host, port };
}

export class RadiusClient {
    private identifier = Math.floor(Math.random() * 256);
    // Concurrent-call guard: the payment webhook and the client poller can
    // both trigger activation of the same payment at the same moment; without
    // this map both would provision a duplicate RADIUS user.
    private activating = new Map<
        string,
        Promise<ProvisionedCredentials | null>
    >();

    constructor(private readonly config: RadiusConfig) {}

    // =========================================================================
    // Package lifecycle (activation / status / deactivation / usage)
    // =========================================================================

    // Idempotently activates the package attached to a paid package payment and
    // returns everything the portal needs for the final redirect to the NAS
    // (credentials + servlet login link). Returns null when the payment does
    // not exist/is not paid, carries no package, or has no login request whose
    // servlet link the portal would re-submit to (hotspot-only hop; PPPoE
    // consumers use ensureProvisioned instead).
    async ensureActivated(
        paymentId: string,
    ): Promise<ActivationRedirect | null> {
        const provisioned = await this.ensureProvisioned(paymentId);
        if (!provisioned) return null;

        const [payment] = await db
            .select()
            .from(packagePayments)
            .where(eq(packagePayments.id, paymentId))
            .limit(1);
        if (!payment) return null;

        const loginRequest = await this.getLoginRequestForPayment(payment);
        return this.buildRedirect(provisioned.activationId, loginRequest);
    }

    // Type-agnostic provisioning core shared by the hotspot and PPPoE flows:
    // ensures a paid payment has an activation with usable RADIUS credentials
    // and returns them. Bank (noExpiry) activations are reconciled first; an
    // exhausted bank yields null. A damaged activation whose password row
    // vanished gets one re-provisioned rather than stranding a paid customer.
    // Returns null when the payment does not exist/is not paid or carries no
    // package.
    async ensureProvisioned(
        paymentId: string,
    ): Promise<ProvisionedCredentials | null> {
        const inFlight = this.activating.get(paymentId);
        if (inFlight) return inFlight;
        const run = this.ensureProvisionedInner(paymentId).finally(() => {
            this.activating.delete(paymentId);
        });
        this.activating.set(paymentId, run);
        return run;
    }

    private async ensureProvisionedInner(
        paymentId: string,
    ): Promise<ProvisionedCredentials | null> {
        const [payment] = await db
            .select()
            .from(packagePayments)
            .where(eq(packagePayments.id, paymentId))
            .limit(1);
        if (!payment || payment.status !== 'paid') return null;

        const [pkg] = await db
            .select()
            .from(packages)
            .where(eq(packages.id, payment.packageId))
            .limit(1);
        if (!pkg) return null;

        // PPPoE dialers use ONE stable RADIUS account per customer; payments
        // extend that account instead of minting new credentials (hotspot
        // keeps its per-activation PK-… users).
        if (pkg.type === 'pppoe') {
            return this.ensurePppoeProvisioned(payment, pkg);
        }

        const existing = await this.getActivationByPayment(payment.id);
        if (existing) {
            // Bank packages must show the current balance before the client
            // is handed credentials; an exhausted bank gets nothing.
            if (pkg.noExpiry) {
                const sync = await this.syncBankAuthorization(existing.id, pkg);
                if (!sync.active) return null;
            }
            const username = activationUsername(existing.id);
            let password = await this.getProvisionedPassword(username);
            if (!password) {
                // Heal a damaged activation whose password row vanished
                // (manual edits / partial cleanup) rather than stranding a
                // paid customer.
                password = randomCredentialPassword(12);
                await db.insert(radcheck).values({
                    username,
                    attribute: 'Cleartext-Password',
                    op: ':=',
                    value: password,
                });
            }
            return { activationId: existing.id, username, password };
        }

        const activation = await this.provisionActivation(payment, pkg);
        const username = activationUsername(activation.id);
        const password = await this.getProvisionedPassword(username);
        if (!password) return null;
        return { activationId: activation.id, username, password };
    }

    // PPPoE provisioning with STABLE per-customer credentials: the RADIUS
    // account (username + password) is generated once on the customer's first
    // PPPoE purchase and reused for every later package. A payment therefore
    // (re-)authorizes the same login: the radcheck Expiration date is moved
    // to the package's expiry and the Access-Accept attributes are refreshed
    // with Session-Timeout set to the time remaining UNTIL that expiry date,
    // so a PPP session lives exactly as long as the paid package. Idempotent
    // per payment (re-polls re-apply the same provisioning).
    private async ensurePppoeProvisioned(
        payment: typeof packagePayments.$inferSelect,
        pkg: typeof packages.$inferSelect,
    ): Promise<ProvisionedCredentials | null> {
        const existing = await this.getActivationByPayment(payment.id);
        const activation =
            existing ?? (await this.provisionPppoeActivation(payment, pkg));

        const username = pppoeUsername(payment.userId);

        // Generate credentials only on the very first PPPoE purchase.
        let password = await this.getProvisionedPassword(username);
        if (!password) {
            password = randomCredentialPassword(12);
            await db.insert(radcheck).values({
                username,
                attribute: 'Cleartext-Password',
                op: ':=',
                value: password,
            });
        }

        await this.applyPppoeAuthorization(activation, pkg);
        return { activationId: activation.id, username, password };
    }

    // (Re-)authorizes the customer's stable PPPoE dialer account from one
    // activation: radcheck Expiration = the package's expiry date, radreply
    // rebuilt with Session-Timeout = time remaining until that expiry (plus
    // the package's Port-Limit / rate / quota attributes and the activation's
    // Class cookie). Also pushes the refreshed Session-Timeout cap to any PPP
    // session already up (renewal while connected; Session-Timeout is one of
    // the attributes RouterOS accepts via CoA).
    private async applyPppoeAuthorization(
        activation: typeof activatedPackages.$inferSelect,
        pkg: typeof packages.$inferSelect,
    ): Promise<void> {
        const username = pppoeUsername(activation.userId);

        await this.upsertCheckAttribute(
            username,
            'Expiration',
            dayjs(activation.expireAt).format('DD MMM YYYY HH:mm:ss'),
        );

        const sessionSeconds = Math.max(
            1,
            Math.round((activation.expireAt.getTime() - Date.now()) / 1000),
        );
        await db.delete(radreply).where(eq(radreply.username, username));
        await db
            .insert(radreply)
            .values(
                this.buildReplyAttributes(
                    username,
                    activation.id,
                    pkg,
                    sessionSeconds,
                ),
            );

        const liveSessions = await this.getSessions({
            username,
            activationId: activation.id,
            liveOnly: true,
        });
        for (const session of liveSessions) {
            await this.coaSessionTimeout(
                username,
                session,
                sessionSeconds,
            ).catch((err) =>
                console.error(
                    `[radius] pppoe re-authorization CoA failed on ${session.nasIpAddress}:`,
                    err,
                ),
            );
        }
    }

    // Credentials of the user's most recent active (non-expired) activation,
    // used by the portal login-complete flow to send a returning customer back
    // to the NAS with their package login instead of a fresh one-off hotspot
    // user. Bank activations are reconciled first so the login they receive
    // carries the current balance as its Session-Timeout; exhausted ones are
    // skipped. Null when nothing usable is active.
    async getActiveActivationCredentials(
        userId: string,
    ): Promise<ProvisionedCredentials | null> {
        const rows = await db
            .select({ activation: activatedPackages, pkg: packages })
            .from(activatedPackages)
            .innerJoin(packages, eq(activatedPackages.packageId, packages.id))
            .where(
                and(
                    eq(activatedPackages.userId, userId),
                    eq(packages.type, 'hotspot'),
                    gte(activatedPackages.expireAt, new Date()),
                ),
            )
            .orderBy(desc(activatedPackages.activatedAt))
            .limit(5);
        for (const row of rows) {
            if (row.pkg.noExpiry) {
                const sync = await this.syncBankAuthorization(
                    row.activation.id,
                    row.pkg,
                );
                if (!sync.active) continue;
            }
            const username = activationUsername(row.activation.id);
            const password = await this.getProvisionedPassword(username);
            if (!password) continue;
            return { activationId: row.activation.id, username, password };
        }
        return null;
    }

    // Credentials of one specific active (non-expired) activation, used by the
    // portal's connected-devices screen to reconnect a device quota that has no
    // live session. Bank (noExpiry) activations are reconciled first so the
    // login carries the current balance; an exhausted bank refuses. A damaged
    // activation whose password row vanished gets one re-provisioned rather
    // than stranding a paid customer. Null when the activation is not this
    // user's, is expired, or is unusable.
    async getActivationCredentials(
        activationId: string,
        userId: string,
    ): Promise<ProvisionedCredentials | null> {
        const [row] = await db
            .select({ activation: activatedPackages, pkg: packages })
            .from(activatedPackages)
            .innerJoin(packages, eq(activatedPackages.packageId, packages.id))
            .where(
                and(
                    eq(activatedPackages.id, activationId),
                    eq(activatedPackages.userId, userId),
                    eq(packages.type, 'hotspot'),
                    gte(activatedPackages.expireAt, new Date()),
                ),
            )
            .limit(1);
        if (!row) return null;
        if (row.pkg.noExpiry) {
            const sync = await this.syncBankAuthorization(
                row.activation.id,
                row.pkg,
            );
            if (!sync.active) return null;
        }
        const username = activationUsername(row.activation.id);
        let password = await this.getProvisionedPassword(username);
        if (!password) {
            password = randomCredentialPassword(12);
            await db.insert(radcheck).values({
                username,
                attribute: 'Cleartext-Password',
                op: ':=',
                value: password,
            });
        }
        return { activationId: row.activation.id, username, password };
    }

    // The user's active (non-expired) activations enriched with live RADIUS
    // usage — the portal status payload (remaining time/bytes, speeds). The
    // optional type restricts the result to one package type so the hotspot
    // and PPPoE portals only see their own activations.
    async getUserPackageStatuses(userId: string, type?: 'hotspot' | 'pppoe') {
        const rows = await db
            .select({
                activation: activatedPackages,
                pkg: packages,
            })
            .from(activatedPackages)
            .innerJoin(packages, eq(activatedPackages.packageId, packages.id))
            .where(
                and(
                    eq(activatedPackages.userId, userId),
                    gte(activatedPackages.expireAt, new Date()),
                    type ? eq(packages.type, type) : undefined,
                ),
            )
            .orderBy(desc(activatedPackages.activatedAt));

        const out = [];
        for (const row of rows) {
            const status = await this.activationStatusFromRows(
                row.activation.id,
                row.activation,
                row.pkg,
            );
            if (!status) continue;
            out.push({
                ...status,
                maxDevices: row.pkg.maxDevices,
                price: Number(row.pkg.price),
                uploadRate: row.pkg.uploadRate,
                downloadRate: row.pkg.downloadRate,
                sessionLength: row.pkg.sessionLength,
                noExpiry: row.pkg.noExpiry,
                category: row.pkg.category,
            });
        }
        return out;
    }

    // Full status + usage of one activation: remaining time/bytes, live
    // sessions, average speed.
    async getPackageStatus(
        activationId: string,
    ): Promise<ActivationStatus | null> {
        const [row] = await db
            .select({ activation: activatedPackages, pkg: packages })
            .from(activatedPackages)
            .innerJoin(packages, eq(activatedPackages.packageId, packages.id))
            .where(eq(activatedPackages.id, activationId))
            .limit(1);
        if (!row) return null;
        return this.activationStatusFromRows(
            activationId,
            row.activation,
            row.pkg,
        );
    }

    // =========================================================================
    // PPPoE dialer accounts (routes/pppoe.ts)
    // =========================================================================

    // The user's active (non-expired) PPPoE activations together with the
    // SHARED stable dialer credentials of the customer (generated once on the
    // first PPPoE purchase, renewed by later payments). The credentials are
    // healed re-provisioning them if their radcheck row vanished.
    async getPppoeClients(userId: string): Promise<
        Array<
            ProvisionedCredentials & {
                packageTitle: string;
                activatedAt: Date;
                expireAt: Date;
                online: boolean;
            }
        >
    > {
        const rows = await db
            .select({ activation: activatedPackages, pkg: packages })
            .from(activatedPackages)
            .innerJoin(packages, eq(activatedPackages.packageId, packages.id))
            .where(
                and(
                    eq(activatedPackages.userId, userId),
                    eq(packages.type, 'pppoe'),
                    gte(activatedPackages.expireAt, new Date()),
                ),
            )
            .orderBy(desc(activatedPackages.activatedAt))
            .limit(20);
        if (rows.length === 0) return [];

        const username = pppoeUsername(userId);
        let password = await this.getProvisionedPassword(username);
        if (!password) {
            password = randomCredentialPassword(12);
            await db.insert(radcheck).values({
                username,
                attribute: 'Cleartext-Password',
                op: ':=',
                value: password,
            });
        }

        const liveSessions = await this.getSessions({
            username,
            activationId: rows[0]!.activation.id,
            liveOnly: true,
        });
        const online = liveSessions.length > 0;

        return rows.map((row) => ({
            activationId: row.activation.id,
            username,
            password: password!,
            packageTitle: row.pkg.title,
            activatedAt: row.activation.activatedAt,
            expireAt: row.activation.expireAt,
            online,
        }));
    }

    // Rotates the password of the customer's stable PPPoE dialer account
    // (referenced through one of their active activations) and disconnects
    // the live PPP session(s) so the new credential takes effect on the next
    // dial. Returns null when the activation is not this user's, is not a
    // PPPoE package, or is expired.
    async rotatePppoePassword(
        activationId: string,
        userId: string,
    ): Promise<ProvisionedCredentials | null> {
        const [row] = await db
            .select({ activation: activatedPackages, pkg: packages })
            .from(activatedPackages)
            .innerJoin(packages, eq(activatedPackages.packageId, packages.id))
            .where(
                and(
                    eq(activatedPackages.id, activationId),
                    eq(activatedPackages.userId, userId),
                    eq(packages.type, 'pppoe'),
                    gte(activatedPackages.expireAt, new Date()),
                ),
            )
            .limit(1);
        if (!row) return null;

        const username = pppoeUsername(userId);
        const password = randomCredentialPassword(12);
        await db.transaction(async (tx) => {
            await tx
                .delete(radcheck)
                .where(
                    and(
                        eq(radcheck.username, username),
                        eq(radcheck.attribute, 'Cleartext-Password'),
                    ),
                );
            await tx.insert(radcheck).values({
                username,
                attribute: 'Cleartext-Password',
                op: ':=',
                value: password,
            });
        });

        // Terminate the running PPP session(s) so the client must re-dial
        // with the new password; the package itself stays active.
        await this.disconnectDeviceSessions(activationId);
        return { activationId, username, password };
    }

    // =========================================================================
    // FreeRADIUS rlm_rest backend (routes/radiusRest.ts)
    // =========================================================================

    // Reverse-resolves one of the generated hotspot RADIUS usernames (PK-…)
    // back to the activation that owns it. The username carries only the
    // first 10 hex characters of the activation id, so candidates are
    // pre-filtered by id-prefix match and then verified with the exact
    // derivation. Null for anything that is not a generated package username
    // (e.g. users provisioned directly in radcheck by the operator).
    async resolveActivationByUsername(username: string): Promise<{
        activation: typeof activatedPackages.$inferSelect;
        pkg: typeof packages.$inferSelect;
    } | null> {
        const normalized = username.trim().toUpperCase();
        const match = /^PK-([0-9A-F]{10})$/.exec(normalized);
        if (!match) return null;
        const suffix = match[1]!.toLowerCase();
        const rows = await db
            .select({ activation: activatedPackages, pkg: packages })
            .from(activatedPackages)
            .innerJoin(packages, eq(activatedPackages.packageId, packages.id))
            .where(
                sql`replace(lower(${activatedPackages.id}::text), '-', '') like ${`${suffix}%`}`,
            )
            .limit(4);
        for (const row of rows) {
            if (activationUsername(row.activation.id) === normalized) {
                return row;
            }
        }
        return null;
    }

    // Reverse-resolves a stable PPPoE RADIUS username (PPP-…) to the user id
    // that owns it. The username carries the first 10 alphanumerics of the
    // compacted user id uppercased, so candidates are pre-filtered by a
    // normalized prefix match and then verified with the exact derivation.
    // Null for anything that is not a generated PPPoE account.
    async resolvePppoeUserByUsername(username: string): Promise<string | null> {
        const normalized = username.trim().toUpperCase();
        const match = /^PPP-([0-9A-Z]{10})$/.exec(normalized);
        if (!match) return null;
        const suffix = match[1]!.toLowerCase();
        const rows = await db
            .select({ userId: user.id })
            .from(user)
            .where(
                sql`regexp_replace(lower(${user.id}::text), '[^a-z0-9]', '', 'g') like ${`${suffix}%`}`,
            )
            .limit(4);
        for (const row of rows) {
            if (pppoeUsername(row.userId) === normalized) {
                return row.userId;
            }
        }
        return null;
    }

    // Verdict for a FreeRADIUS rlm_rest authorization query (the rest module
    // `authorize` section), mapped by the route onto HTTP status codes per
    // rlm_rest's authorize table:
    //  - unknown:   not a package activation / dialer account -> 404 ->
    //               "notfound", so the authorize chain falls through to the
    //               remaining modules (sql) which may know the user.
    //  - expired:   static validity window closed -> 403 -> "userlock"
    //               (rejected; mirrors what the radcheck Expiration row +
    //               stock expiration module would do).
    //  - exhausted: cumulative time bank consumed -> 403; syncBankAuthorization
    //               additionally invalidates the credential (Auth-Type :=
    //               Reject) and cuts live sessions.
    //  - ok:        200 with the session's Access-Accept attributes serialised
    //               in rlm_rest JSON form (reply:<attribute>, FreeRADIUS 3.x
    //               qualifier syntax). The payload mirrors radreply exactly —
    //               bank (noExpiry) balances are reconciled first, so when the
    //               SQL module also emits radreply rows the attribute values
    //               agree and the duplication is harmless; when rest is the
    //               only reply source the attributes stay fresh regardless of
    //               the reconciler tick.
    //
    // PPPoE dialers authenticate with the customer's STABLE account (PPP-…),
    // which carries no activation id: those are resolved to the owning user
    // and authorized from their newest active PPPoE activation, with the
    // Session-Timeout set to the time remaining until that activation's
    // expiry date (the same attribute set the provisioning path applies at
    // payment time).
    async restAuthorize(
        username: string,
    ): Promise<
        | { verdict: 'unknown' }
        | { verdict: 'expired' }
        | { verdict: 'exhausted' }
        | { verdict: 'ok'; attributes: RadiusRestReply }
    > {
        const row = await this.resolveActivationByUsername(username);
        if (!row) return this.restAuthorizePppoe(username);
        if (row.activation.expireAt.getTime() < Date.now()) {
            return { verdict: 'expired' };
        }
        let sessionSeconds = row.pkg.sessionLength * 60;

        const sync = await this.syncBankAuthorization(
            row.activation.id,
            row.pkg,
        );
        if (!sync.active) return { verdict: 'exhausted' };
        sessionSeconds = sync.remainingSeconds;

        return {
            verdict: 'ok',
            attributes: this.buildRestReplyAttributes(
                row.activation.id,
                row.pkg,
                sessionSeconds,
            ),
        };
    }

    // rlm_rest authorize for a stable PPPoE account (PPP-…). Unknown
    // usernames fall through to the remaining authorize modules; an account
    // whose newest PPPoE activation has expired is locked out.
    private async restAuthorizePppoe(
        username: string,
    ): Promise<
        | { verdict: 'unknown' }
        | { verdict: 'expired' }
        | { verdict: 'ok'; attributes: RadiusRestReply }
    > {
        const userId = await this.resolvePppoeUserByUsername(username);
        if (!userId) return { verdict: 'unknown' };

        const [row] = await db
            .select({ activation: activatedPackages, pkg: packages })
            .from(activatedPackages)
            .innerJoin(packages, eq(activatedPackages.packageId, packages.id))
            .where(
                and(
                    eq(activatedPackages.userId, userId),
                    eq(packages.type, 'pppoe'),
                ),
            )
            .orderBy(desc(activatedPackages.activatedAt))
            .limit(1);
        if (!row) return { verdict: 'unknown' };
        if (row.activation.expireAt.getTime() < Date.now()) {
            return { verdict: 'expired' };
        }

        // Session-Timeout = time remaining until the activation's expiry
        // date, so the PPP session lives exactly as long as the package
        // (identical to the radreply rows written at activation/renewal).
        const sessionSeconds = Math.max(
            1,
            Math.round((row.activation.expireAt.getTime() - Date.now()) / 1000),
        );
        return {
            verdict: 'ok',
            attributes: this.buildRestReplyAttributes(
                row.activation.id,
                row.pkg,
                sessionSeconds,
            ),
        };
    }

    // Deactivates a package: removes the RADIUS provisioning (no further
    // logins), expires the activation record, and terminates every live
    // session by sending a session-targeted Disconnect-Request directly to
    // the NAS holding it (keyed on Acct-Session-Id, signed with the NAS's own
    // shared secret). Provisioning removal is authoritative; a missed
    // Disconnect still ends the session at the next Session-Timeout /
    // Idle-Timeout boundary. For PPPoE (stable per-customer credentials) the
    // account survives while the user still has another active activation —
    // it is re-authorized from that one instead of being deleted.
    async deactivateActivation(activationId: string): Promise<{
        ok: boolean;
        message: string;
        sessionsFound: number;
        sessionsDisconnected: number;
        failures: Array<{ nasIpAddress: string; reason: string }>;
    }> {
        const [activation] = await db
            .select()
            .from(activatedPackages)
            .where(eq(activatedPackages.id, activationId))
            .limit(1);
        if (!activation) {
            return {
                ok: false,
                message: 'Unknown activation',
                sessionsFound: 0,
                sessionsDisconnected: 0,
                failures: [],
            };
        }

        const [pkg] = await db
            .select()
            .from(packages)
            .where(eq(packages.id, activation.packageId))
            .limit(1);
        const isPppoe = pkg?.type === 'pppoe';

        const username = isPppoe
            ? pppoeUsername(activation.userId)
            : activationUsername(activationId);
        const liveSessions = await this.getSessions({
            username,
            activationId,
            liveOnly: true,
        });

        let sessionsDisconnected = 0;
        const failures: Array<{ nasIpAddress: string; reason: string }> = [];
        const disconnectAll = async () => {
            for (const session of liveSessions) {
                try {
                    const ack = await this.terminateSessionAtNas(
                        username,
                        session,
                    );
                    if (ack) {
                        sessionsDisconnected++;
                        await this.closeSessionRecord(session);
                    } else {
                        failures.push({
                            nasIpAddress: session.nasIpAddress,
                            reason: 'NAS answered Disconnect-NAK',
                        });
                    }
                } catch (err) {
                    failures.push({
                        nasIpAddress: session.nasIpAddress,
                        reason:
                            err instanceof Error ? err.message : String(err),
                    });
                }
            }
        };

        if (isPppoe) {
            await disconnectAll();
            await db
                .update(activatedPackages)
                .set({ expireAt: new Date() })
                .where(eq(activatedPackages.id, activationId));

            // The stable dialer account belongs to the CUSTOMER, not this
            // activation: keep it (re-authorized from the newest remaining
            // active package) while another PPPoE activation is still valid.
            const [other] = await db
                .select({ activation: activatedPackages, pkg: packages })
                .from(activatedPackages)
                .innerJoin(
                    packages,
                    eq(activatedPackages.packageId, packages.id),
                )
                .where(
                    and(
                        eq(activatedPackages.userId, activation.userId),
                        ne(activatedPackages.id, activationId),
                        eq(packages.type, 'pppoe'),
                        gte(activatedPackages.expireAt, new Date()),
                    ),
                )
                .orderBy(desc(activatedPackages.activatedAt))
                .limit(1);
            if (other) {
                await this.applyPppoeAuthorization(other.activation, other.pkg);
            } else {
                await Promise.all([
                    db.delete(radcheck).where(eq(radcheck.username, username)),
                    db.delete(radreply).where(eq(radreply.username, username)),
                ]);
            }
        } else {
            await Promise.all([
                db.delete(radcheck).where(eq(radcheck.username, username)),
                db.delete(radreply).where(eq(radreply.username, username)),
                db
                    .update(activatedPackages)
                    .set({ expireAt: new Date() })
                    .where(eq(activatedPackages.id, activationId)),
            ]);
            // One session-targeted Disconnect per live session, sent directly
            // to the NAS holding it (keyed on Acct-Session-Id).
            await disconnectAll();
        }

        const ok = failures.length === 0;
        const message = ok
            ? liveSessions.length === 0
                ? 'Package deactivated'
                : 'Package deactivated and all live sessions terminated'
            : `Package deactivated but ${failures.length} session(s) could not be terminated at the NAS`;
        return {
            ok,
            message,
            sessionsFound: liveSessions.length,
            sessionsDisconnected,
            failures,
        };
    }

    // Disconnects live session(s) of an activation WITHOUT touching the package
    async disconnectDeviceSessions(
        activationId: string,
        opts: { sessionId?: string } = {},
    ): Promise<{
        ok: boolean;
        message: string;
        sessionsFound: number;
        sessionsDisconnected: number;
        failures: Array<{ nasIpAddress: string; reason: string }>;
    }> {
        const [activation] = await db
            .select({
                ...getTableColumns(activatedPackages),
                username: radacct.username,
            })
            .from(activatedPackages)
            .leftJoin(
                radacct,
                eq(radacct.radacctid, activatedPackages.radacctId),
            )
            .where(eq(activatedPackages.id, activationId))
            .limit(1);
        if (!activation) {
            return {
                ok: false,
                message: 'Unknown activation',
                sessionsFound: 0,
                sessionsDisconnected: 0,
                failures: [],
            };
        }

        const username =
            activation.username ?? activationUsername(activationId);

        let liveSessions = await this.getSessions({
            username,
            activationId,
            liveOnly: true,
        });
        if (opts.sessionId) {
            liveSessions = liveSessions.filter(
                (s) => s.radacctId === opts.sessionId,
            );
        }
        if (liveSessions.length === 0) {
            return {
                ok: true,
                message: 'No active session to disconnect',
                sessionsFound: 0,
                sessionsDisconnected: 0,
                failures: [],
            };
        }

        let sessionsDisconnected = 0;
        const failures: Array<{ nasIpAddress: string; reason: string }> = [];
        for (const session of liveSessions) {
            try {
                const ack = await this.terminateSessionAtNas(username, session);
                if (ack) {
                    sessionsDisconnected++;
                    await this.closeSessionRecord(session);
                } else {
                    failures.push({
                        nasIpAddress: session.nasIpAddress,
                        reason: 'NAS answered Disconnect-NAK',
                    });
                }
            } catch (err) {
                failures.push({
                    nasIpAddress: session.nasIpAddress,
                    reason: err instanceof Error ? err.message : String(err),
                });
            }
        }

        const ok = failures.length === 0;
        return {
            ok,
            message: ok
                ? 'Session disconnected — the package stays active'
                : `${failures.length} session(s) could not be disconnected at the NAS`,
            sessionsFound: liveSessions.length,
            sessionsDisconnected,
            failures,
        };
    }

    // =========================================================================
    // Admin operations (routes/admin.ts user/session management)
    // =========================================================================

    // All activations (including expired/deactivated ones) of one user — or
    // of every user when no userId is given — enriched with RADIUS usage.
    // Newest first. The optional type matches the underlying package type.
    async getAdminActivations(
        opts: {
            userId?: string;
            type?: 'hotspot' | 'pppoe';
            limit?: number;
        } = {},
    ): Promise<AdminActivationStatus[]> {
        const rows = await db
            .select({ activation: activatedPackages, pkg: packages })
            .from(activatedPackages)
            .innerJoin(packages, eq(activatedPackages.packageId, packages.id))
            .where(
                and(
                    opts.userId
                        ? eq(activatedPackages.userId, opts.userId)
                        : undefined,
                    opts.type ? eq(packages.type, opts.type) : undefined,
                ),
            )
            .orderBy(desc(activatedPackages.activatedAt))
            .limit(opts.limit ?? 200);

        const out: AdminActivationStatus[] = [];
        for (const row of rows) {
            const status = await this.activationStatusFromRows(
                row.activation.id,
                row.activation,
                row.pkg,
            );
            if (!status) continue;
            out.push({
                ...status,
                userId: row.activation.userId,
                packageType: row.pkg.type,
                noExpiry: row.pkg.noExpiry,
                maxDevices: row.pkg.maxDevices,
            });
        }
        return out;
    }

    // Restores a deactivated/expired activation: the expiry restarts from now
    // (the package's validity rules) and the RADIUS provisioning is rebuilt so
    // the user can log back in. For PPPoE the customer's stable dialer
    // account is re-authorized from this activation. Returns the new expiry.
    async reactivateActivation(activationId: string): Promise<{
        ok: boolean;
        message: string;
        expireAt: Date | null;
    }> {
        const [row] = await db
            .select({ activation: activatedPackages, pkg: packages })
            .from(activatedPackages)
            .innerJoin(packages, eq(activatedPackages.packageId, packages.id))
            .where(eq(activatedPackages.id, activationId))
            .limit(1);
        if (!row) {
            return { ok: false, message: 'Unknown activation', expireAt: null };
        }

        const { activation, pkg } = row;
        const expireAt = pkg.noExpiry
            ? dayjs()
                  .add(pkg.validityDays ?? 30, 'day')
                  .toDate()
            : dayjs().add(pkg.sessionLength, 'minute').toDate();
        activation.expireAt = expireAt;
        await db
            .update(activatedPackages)
            .set({ expireAt })
            .where(eq(activatedPackages.id, activationId));

        if (pkg.type === 'pppoe') {
            const username = pppoeUsername(activation.userId);
            if (!(await this.getProvisionedPassword(username))) {
                await db.insert(radcheck).values({
                    username,
                    attribute: 'Cleartext-Password',
                    op: ':=',
                    value: randomCredentialPassword(12),
                });
            }
            await this.applyPppoeAuthorization(activation, pkg);
            return {
                ok: true,
                message: 'PPPoE activation re-authorized',
                expireAt,
            };
        }

        const username = activationUsername(activationId);
        if (!(await this.getProvisionedPassword(username))) {
            await db.insert(radcheck).values({
                username,
                attribute: 'Cleartext-Password',
                op: ':=',
                value: randomCredentialPassword(12),
            });
        }
        await this.upsertCheckAttribute(
            username,
            'Expiration',
            dayjs(expireAt).format('DD MMM YYYY HH:mm:ss'),
        );

        // Bank packages advertise the remaining cumulative balance as their
        // Session-Timeout; regular packages the per-session allowance.
        let sessionSeconds = pkg.sessionLength * 60;
        if (pkg.noExpiry) {
            const usage = await this.getBankUsage(activationId);
            sessionSeconds = usage?.remainingSeconds ?? 0;
        }
        await db.delete(radreply).where(eq(radreply.username, username));
        await db
            .insert(radreply)
            .values(
                this.buildReplyAttributes(
                    username,
                    activationId,
                    pkg,
                    sessionSeconds,
                ),
            );

        if (pkg.noExpiry && sessionSeconds <= 0) {
            await this.deactivateActivation(activationId);
            return {
                ok: false,
                message:
                    'The cumulative time bank is exhausted; reactivation was rolled back',
                expireAt: null,
            };
        }
        return { ok: true, message: 'Activation restored', expireAt };
    }

    // Moves an activation's expiry to a new date and keeps the RADIUS side in
    // step: hotspot logins are gated by the radcheck Expiration row, and for
    // PPPoE / bank packages the Session-Timeout cap of the next (and any
    // live) session derives from the new expiry. A deactivated activation
    // only moves its DB record until it is re-activated.
    async setActivationExpiry(
        activationId: string,
        expireAt: Date,
    ): Promise<{ ok: boolean; message: string }> {
        const [row] = await db
            .select({ activation: activatedPackages, pkg: packages })
            .from(activatedPackages)
            .innerJoin(packages, eq(activatedPackages.packageId, packages.id))
            .where(eq(activatedPackages.id, activationId))
            .limit(1);
        if (!row) return { ok: false, message: 'Unknown activation' };

        row.activation.expireAt = expireAt;
        await db
            .update(activatedPackages)
            .set({ expireAt })
            .where(eq(activatedPackages.id, activationId));

        if (row.pkg.type === 'pppoe') {
            await this.applyPppoeAuthorization(row.activation, row.pkg);
            return { ok: true, message: 'Expiry updated' };
        }

        const username = activationUsername(activationId);
        if (await this.getProvisionedPassword(username)) {
            await this.upsertCheckAttribute(
                username,
                'Expiration',
                dayjs(expireAt).format('DD MMM YYYY HH:mm:ss'),
            );
            if (row.pkg.noExpiry) {
                await this.syncBankAuthorization(activationId, row.pkg);
            }
            return { ok: true, message: 'Expiry updated' };
        }
        return {
            ok: true,
            message:
                'Expiry updated — the activation is not provisioned; re-activate it to restore logins',
        };
    }

    // Disconnects one live session (of any user) addressed by its radacct id.
    // Termination goes directly to the NAS holding the session.
    async disconnectSessionByRadacctId(radacctId: string): Promise<{
        ok: boolean;
        message: string;
    }> {
        const [row] = await db
            .select()
            .from(radacct)
            .where(eq(radacct.radacctid, BigInt(radacctId)))
            .limit(1);
        if (!row) return { ok: false, message: 'Unknown session' };
        if (row.acctstoptime !== null || row.acctstarttime === null) {
            return { ok: false, message: 'Session is not live' };
        }
        const session = this.sessionInfoFromRow(row);
        const username = row.username ?? '';
        try {
            const ack = await this.terminateSessionAtNas(username, session);
            if (!ack) {
                return { ok: false, message: 'NAS answered Disconnect-NAK' };
            }
            await this.closeSessionRecord(session);
            return { ok: true, message: 'Session disconnected' };
        } catch (err) {
            return {
                ok: false,
                message: err instanceof Error ? err.message : String(err),
            };
        }
    }

    // Live-edits one session's remaining time by pushing a new Session-Timeout
    // to the NAS via CoA (RFC 5176; RouterOS accepts Session-Timeout via CoA).
    async setSessionTimeoutByRadacctId(
        radacctId: string,
        seconds: number,
    ): Promise<{ ok: boolean; message: string }> {
        const [row] = await db
            .select()
            .from(radacct)
            .where(eq(radacct.radacctid, BigInt(radacctId)))
            .limit(1);
        if (!row) return { ok: false, message: 'Unknown session' };
        if (row.acctstoptime !== null || row.acctstarttime === null) {
            return { ok: false, message: 'Session is not live' };
        }
        const session = this.sessionInfoFromRow(row);
        const username = row.username ?? '';
        try {
            const ack = await this.coaSessionTimeout(
                username,
                session,
                Math.max(1, Math.round(seconds)),
            );
            if (!ack) {
                return { ok: false, message: 'NAS answered CoA-NAK' };
            }
            return { ok: true, message: 'Session time updated' };
        } catch (err) {
            return {
                ok: false,
                message: err instanceof Error ? err.message : String(err),
            };
        }
    }

    // The customer's stable PPPoE dialer credentials for admin display. The
    // password is null when the account exists without a credential row (or
    // was never provisioned at all).
    async getPppoeCredentials(
        userId: string,
    ): Promise<{ username: string; password: string | null }> {
        const username = pppoeUsername(userId);
        const password = await this.getProvisionedPassword(username);
        return { username, password };
    }

    // Sets the customer's stable PPPoE dialer password (a random one when
    // omitted — the admin "rotate" flow) and disconnects live PPP sessions so
    // the new credential takes effect on the next dial.
    async setPppoePassword(
        userId: string,
        password?: string,
    ): Promise<{
        username: string;
        password: string;
        sessionsDisconnected: number;
    }> {
        const username = pppoeUsername(userId);
        const newPassword = password ?? randomCredentialPassword(12);
        await db.transaction(async (tx) => {
            await tx
                .delete(radcheck)
                .where(
                    and(
                        eq(radcheck.username, username),
                        eq(radcheck.attribute, 'Cleartext-Password'),
                    ),
                );
            await tx.insert(radcheck).values({
                username,
                attribute: 'Cleartext-Password',
                op: ':=',
                value: newPassword,
            });
        });

        // Live PPP sessions hold the old credential; cut them so the dialer
        // re-authenticates with the new password.
        const liveSessions = await this.getSessions({
            username,
            activationId: '',
            liveOnly: true,
        });
        let sessionsDisconnected = 0;
        for (const session of liveSessions) {
            try {
                if (await this.terminateSessionAtNas(username, session)) {
                    sessionsDisconnected++;
                    await this.closeSessionRecord(session);
                }
            } catch (err) {
                console.error(
                    `[radius] admin pppoe password disconnect failed on ${session.nasIpAddress}:`,
                    err,
                );
            }
        }
        return { username, password: newPassword, sessionsDisconnected };
    }

    // =========================================================================
    // Metrics
    // =========================================================================

    // Admin-facing aggregate usage over a trailing window: live session/user
    // counts, current throughput and per-session average speed, sessions
    // started inside the window, and the heaviest users.
    async getNetworkUsage(windowMinutes: number): Promise<NetworkUsage> {
        const windowMs = Math.max(1, windowMinutes) * 60_000;
        const windowStart = new Date(Date.now() - windowMs);
        const windowSeconds = windowMs / 1000;
        const now = Date.now();

        const liveRows = await db
            .select()
            .from(radacct)
            .where(
                and(
                    isNull(radacct.acctstoptime),
                    isNotNull(radacct.acctstarttime),
                ),
            );

        let liveOctets = 0;
        let aggregateBps = 0;
        const sessionRates: number[] = [];
        const liveUsers = new Set<string>();
        for (const row of liveRows) {
            const octets =
                Number(row.acctinputoctets ?? 0) +
                Number(row.acctoutputoctets ?? 0);
            liveOctets += octets;
            if (row.username) liveUsers.add(row.username);
            const elapsed = row.acctstarttime
                ? Math.max(
                      1,
                      Math.min(
                          windowSeconds,
                          (now - row.acctstarttime.getTime()) / 1000,
                      ),
                  )
                : windowSeconds;
            const bps = (octets * 8) / elapsed;
            aggregateBps += bps;
            sessionRates.push(bps);
        }

        const [windowStats] = await db
            .select({
                sessions: sql<number>`count(*)`,
                avgSeconds: sql<number>`coalesce(avg(${radacct.acctsessiontime}), 0)::float8`,
            })
            .from(radacct)
            .where(gte(radacct.acctstarttime, windowStart));

        const topUsers = await db
            .select({
                username: radacct.username,
                octets: sql<number>`coalesce(sum(${radacct.acctinputoctets} + ${radacct.acctoutputoctets}), 0)::float8`,
                sessions: sql<number>`count(*)`,
            })
            .from(radacct)
            .where(gte(radacct.acctstarttime, windowStart))
            .groupBy(radacct.username)
            .orderBy(
                desc(
                    sql`sum(${radacct.acctinputoctets} + ${radacct.acctoutputoctets})`,
                ),
            )
            .limit(10);

        return {
            windowMinutes,
            liveSessions: liveRows.length,
            liveUsers: liveUsers.size,
            liveOctets,
            aggregateThroughputBps: Math.round(aggregateBps),
            avgSpeedPerSessionBps: sessionRates.length
                ? Math.round(
                      sessionRates.reduce((a, b) => a + b, 0) /
                          sessionRates.length,
                  )
                : 0,
            sessionsStartedInWindow: Number(windowStats?.sessions ?? 0),
            avgSessionSeconds: Number(windowStats?.avgSeconds ?? 0),
            topUsers: topUsers.map((u) => ({
                username: u.username ?? '',
                octets: Number(u.octets),
                sessions: Number(u.sessions),
            })),
        };
    }

    // Live session board for admins (most recent first). Anchor rows (the
    // NOT-NULL-locked activation placeholders) have no accounting start time,
    // so a real live session is: no stop record yet, but already started.
    async getLiveSessions(limit = 100): Promise<SessionInfo[]> {
        const rows = await db
            .select()
            .from(radacct)
            .where(
                and(
                    isNull(radacct.acctstoptime),
                    isNotNull(radacct.acctstarttime),
                ),
            )
            .orderBy(desc(radacct.acctstarttime))
            .limit(limit);
        return rows.map((row) => this.sessionInfoFromRow(row));
    }

    // =========================================================================
    // Diagnostics / direct protocol
    // =========================================================================

    // Validates credentials against the RADIUS SERVER with a real PAP
    // Access-Request. Hotspot logins from the NAS use CHAP; PAP against the
    // same radcheck row is equivalent for a server-side provisioning check.
    async checkCredentials(
        username: string,
        password: string,
    ): Promise<{ accepted: boolean; message: string }> {
        const target = parseRadiusServerUrl(this.config.serverUrl);
        if (!this.config.secret) {
            throw new RadiusError(
                'RADIUS_SECRET is not configured; cannot sign RADIUS packets.',
            );
        }
        const reply = await this.sendPacket(
            CODE.ACCESS_REQUEST,
            target,
            this.config.secret,
            [
                { type: ATTR.USER_NAME, value: username },
                { type: ATTR.USER_PASSWORD, value: password },
                { type: ATTR.NAS_IDENTIFIER, value: 'radii-api' },
            ],
            new Set([CODE.ACCESS_ACCEPT, CODE.ACCESS_REJECT]),
        );
        const messageAttr = reply.attributes.find(
            (a) => a.type === ATTR.REPLY_MESSAGE,
        );
        return {
            accepted: reply.code === CODE.ACCESS_ACCEPT,
            message: messageAttr
                ? attrToString(messageAttr.data)
                : reply.code === CODE.ACCESS_ACCEPT
                  ? 'Access-Accept'
                  : 'Access-Reject',
        };
    }

    // Low-level RFC 5176 Disconnect-Request primitive; the session-termination
    // flows send these directly to the NAS's `/radius/incoming` listener.
    // Returns true on Disconnect-ACK.
    async sendDisconnectRequest(
        target: { host: string; port: number },
        secret: string,
        attributes: RadiusOutAttribute[],
    ): Promise<boolean> {
        const reply = await this.sendPacket(
            CODE.DISCONNECT_REQUEST,
            target,
            secret,
            this.withEventTimestamp(attributes),
            new Set([CODE.DISCONNECT_ACK, CODE.DISCONNECT_NAK]),
        );
        return reply.code === CODE.DISCONNECT_ACK;
    }

    // RFC 5176 CoA-Request. The bank reconciler sends these directly to the
    // NAS's `/radius/incoming` listener to re-authorize a live session
    // (Session-Timeout cap); RouterOS accepts exactly the attributes listed in
    // its RADIUS manual for CoA changes. Returns true on CoA-ACK.
    async sendCoARequest(
        target: { host: string; port: number },
        secret: string,
        attributes: RadiusOutAttribute[],
    ): Promise<boolean> {
        const reply = await this.sendPacket(
            CODE.COA_REQUEST,
            target,
            secret,
            this.withEventTimestamp(attributes),
            new Set([CODE.COA_ACK, CODE.COA_NAK]),
        );
        return reply.code === CODE.COA_ACK;
    }

    // =========================================================================
    // Cumulative time bank (noExpiry packages)
    // =========================================================================

    // Balance of an activation's time bank: the package's sessionLength is the
    // TOTAL minutes consumable across sessions within the validity window.
    // Usage = closed sessions' Acct-Session-Time + live sessions' elapsed
    // time (accounting interim updates keep the closed-figure side fresh).
    async getBankUsage(activationId: string): Promise<{
        totalSeconds: number;
        usedSeconds: number;
        remainingSeconds: number;
    } | null> {
        const [row] = await db
            .select({ pkg: packages })
            .from(activatedPackages)
            .innerJoin(packages, eq(activatedPackages.packageId, packages.id))
            .where(eq(activatedPackages.id, activationId))
            .limit(1);
        if (!row) return null;

        const totalSeconds = row.pkg.sessionLength * 60;
        const sessions = await this.getSessions({
            username: activationUsername(activationId),
            activationId,
        });
        let usedSeconds = 0;
        for (const session of sessions) {
            usedSeconds += session.seconds;
        }
        return {
            totalSeconds,
            usedSeconds: Math.round(usedSeconds),
            remainingSeconds: Math.max(
                0,
                Math.round(totalSeconds - usedSeconds),
            ),
        };
    }

    // Reconciles one bank activation against its current balance:
    //  - balance left: radreply Session-Timeout becomes the remaining bank
    //    (the next login gets the fresh cap) and every live session receives
    //    a CoA Session-Timeout with the same value, so the NAS enforces the
    //    cumulative cap mid-session. Concurrent sessions each carry the FULL
    //    remaining balance; the drift is bounded by the reconcile interval.
    //  - balance gone: the credential is invalidated (radcheck
    //    `Auth-Type := Reject`) so future logins fail at the RADIUS server,
    //    and live sessions are disconnected at the NAS.
    // Live on every login/redirect path too, so reconnects always carry the
    // current balance even between reconciler ticks.
    async syncBankAuthorization(
        activationId: string,
        pkg: typeof packages.$inferSelect,
    ): Promise<{ active: boolean; remainingSeconds: number }> {
        const username = activationUsername(activationId);
        const usage = await this.getBankUsage(activationId);
        const remainingSeconds = usage?.remainingSeconds ?? 0;
        const liveSessions = await this.getSessions({
            username,
            activationId,
            liveOnly: true,
        });

        if (remainingSeconds <= 0) {
            await this.deactivateActivation(activationId);
            return { active: false, remainingSeconds: 0 };
        }

        await this.upsertReplyAttribute(
            username,
            'Session-Timeout',
            String(remainingSeconds),
        );
        for (const session of liveSessions) {
            await this.coaSessionTimeout(
                username,
                session,
                remainingSeconds,
            ).catch((err) =>
                console.error(
                    `[radius] bank CoA failed on ${session.nasIpAddress}:`,
                    err,
                ),
            );
        }
        return { active: true, remainingSeconds };
    }

    // Periodic bank reconciliation: every active bank activation gets its
    // balance re-checked (caps pushed / exhausted ones cut), and activations
    // whose validity window has closed still get their live sessions
    // disconnected (the radcheck Expiration date already blocks fresh logins,
    // but running sessions survive without this sweep). Hotspot only: PPPoE
    // uses stable credentials whose sessions are capped at the package's
    // expiry date at authorization time (no cumulative bank accounting).
    async reconcileBankPackages(): Promise<number> {
        const rows = await db
            .select({ activation: activatedPackages, pkg: packages })
            .from(activatedPackages)
            .innerJoin(packages, eq(activatedPackages.packageId, packages.id))
            .where(
                and(eq(packages.noExpiry, true), eq(packages.type, 'hotspot')),
            );

        let touched = 0;
        for (const row of rows) {
            try {
                if (row.activation.expireAt.getTime() < Date.now()) {
                    const username = activationUsername(row.activation.id);
                    const liveSessions = await this.getSessions({
                        username,
                        activationId: row.activation.id,
                        liveOnly: true,
                    });
                    for (const session of liveSessions) {
                        try {
                            if (
                                await this.terminateSessionAtNas(
                                    username,
                                    session,
                                )
                            ) {
                                await this.closeSessionRecord(session);
                            }
                        } catch (err) {
                            console.error(
                                `[radius] expiry disconnect failed on ${session.nasIpAddress}:`,
                                err,
                            );
                        }
                    }
                    if (liveSessions.length) touched++;
                    continue;
                }
                await this.syncBankAuthorization(row.activation.id, row.pkg);
                touched++;
            } catch (err) {
                console.error(
                    `[radius] bank reconcile failed for activation ${row.activation.id}:`,
                    err,
                );
            }
        }
        return touched;
    }

    // =========================================================================
    // Internals — provisioning (FreeRADIUS SQL backend)
    // =========================================================================

    private withEventTimestamp(
        attributes: RadiusOutAttribute[],
    ): RadiusOutAttribute[] {
        if (attributes.some((a) => a.type === ATTR.EVENT_TIMESTAMP)) {
            return attributes;
        }
        return [
            ...attributes,
            {
                type: ATTR.EVENT_TIMESTAMP,
                value: Math.floor(Date.now() / 1000),
            },
        ];
    }

    private async provisionActivation(
        payment: typeof packagePayments.$inferSelect,
        pkg: typeof packages.$inferSelect,
    ) {
        const expireAt = pkg.noExpiry
            ? dayjs().add(pkg.validityDays ?? 30, 'days')
            : dayjs().add(pkg.sessionLength, 'minutes');

        const activationId = randomUUID();
        const username = activationUsername(activationId);
        const password = randomCredentialPassword(12);

        // activated_packages.radacct_id is NOT NULL but the NAS only creates
        // accounting rows once the first session opens; insert an anchor row
        // now. Its Class cookie is the activation id, which the RADIUS reply
        // sets on every future Access-Accept and accounting echoes back into
        // radacct.class — that is the correlation key for usage and deauth.
        const anchorNasIp =
            (await this.getLoginRequestNasIp(payment)) ?? '0.0.0.0';

        const [activation] = await db.transaction(async (tx) => {
            const [anchor] = await tx
                .insert(radacct)
                .values({
                    acctsessionid: `RADII-${activationId.replace(/-/g, '').slice(0, 12)}`,
                    acctuniqueid: randomUUID(),
                    username,
                    nasipaddress: anchorNasIp,
                    servicetype: 'Package-Activation',
                    class: activationId,
                })
                .returning();

            await tx.insert(radcheck).values([
                {
                    username,
                    attribute: 'Cleartext-Password',
                    op: ':=',
                    value: password,
                },

                {
                    username,
                    attribute: 'Expiration',
                    op: ':=',
                    value: expireAt.format('DD MMM YYYY HH:mm:ss'),
                },
            ]);

            await tx
                .insert(radreply)
                .values(
                    this.buildReplyAttributes(
                        username,
                        activationId,
                        pkg,
                        pkg.sessionLength * 60,
                    ),
                );

            const [row] = await tx
                .insert(activatedPackages)
                .values({
                    id: activationId,
                    packagePaymentId: payment.id,
                    radacctId: anchor.radacctid,
                    userId: payment.userId,
                    packageId: pkg.id,
                    activatedAt: new Date(),
                    expireAt: expireAt.toDate(),
                })
                .returning();
            return [row];
        });
        return activation;
    }

    // PPPoE counterpart of provisionActivation, but WITHOUT per-activation
    // credentials: the stable per-customer RADIUS account is maintained by
    // ensurePppoeProvisioned, so this only records the activation (anchor
    // accounting row + activated_packages row).
    private async provisionPppoeActivation(
        payment: typeof packagePayments.$inferSelect,
        pkg: typeof packages.$inferSelect,
    ) {
        const expireAt = pkg.noExpiry
            ? dayjs().add(pkg.validityDays ?? 30, 'days')
            : dayjs().add(pkg.sessionLength, 'minutes');

        const activationId = randomUUID();
        const username = pppoeUsername(payment.userId);

        // Anchor accounting row (Class carries the activation id so sessions
        // of the shared dialer account still correlate to this purchase).
        const [activation] = await db.transaction(async (tx) => {
            const [anchor] = await tx
                .insert(radacct)
                .values({
                    acctsessionid: `RADII-${activationId.replace(/-/g, '').slice(0, 12)}`,
                    acctuniqueid: randomUUID(),
                    username,
                    nasipaddress: '0.0.0.0',
                    servicetype: 'Package-Activation',
                    class: activationId,
                })
                .returning();

            const [row] = await tx
                .insert(activatedPackages)
                .values({
                    id: activationId,
                    packagePaymentId: payment.id,
                    radacctId: anchor.radacctid,
                    userId: payment.userId,
                    packageId: pkg.id,
                    activatedAt: new Date(),
                    expireAt: expireAt.toDate(),
                })
                .returning();
            return [row];
        });
        return activation;
    }

    // Access-Accept attributes of one activation's session, computed once and
    // shared by both provisioning consumers below: Session-Timeout (session
    // length), Port-Limit (max simultaneous logins — RouterOS maps this to
    // shared-users), Mikrotik-Rate-Limit (first value = client upload /
    // router rx, 'k'/'M' units), Mikrotik-Total-Limit (+Gigawords above
    // 4 GiB) for the byte quota, and the Class cookie for accounting
    // correlation. Bank (noExpiry) packages additionally request a short
    // Acct-Interim-Interval so the cumulative-time counters in radacct stay
    // fresh; their Session-Timeout is the remaining bank balance and is
    // re-synced at every login and by the bank reconciler.
    private sessionReplyAttributes(
        activationId: string,
        pkg: typeof packages.$inferSelect,
        sessionSeconds: number,
    ): Array<{ attribute: string; value: string | number }> {
        const attrs: Array<{ attribute: string; value: string | number }> = [
            { attribute: 'Session-Timeout', value: sessionSeconds },
            { attribute: 'Port-Limit', value: pkg.maxDevices },
            { attribute: 'Class', value: activationId },
        ];

        if (pkg.noExpiry) {
            attrs.push({
                attribute: 'Acct-Interim-Interval',
                value: this.config.bankInterimSeconds,
            });
        }

        if (pkg.uploadRate > 0 || pkg.downloadRate > 0) {
            // Package rates are Kbps; MikroTik's 'k' suffix denotes thousands.
            // 0 is read as unlimited by RouterOS queuing.
            attrs.push({
                attribute: 'Mikrotik-Rate-Limit',
                value: `${pkg.uploadRate}k/${pkg.downloadRate}k`,
            });
        }

        const quotaBytes = (pkg.downloadQuota + pkg.uploadQuota) * 1024;
        if (quotaBytes > 0) {
            attrs.push({
                attribute: 'Mikrotik-Total-Limit',
                value: quotaBytes % GIGAWORD,
            });
            if (quotaBytes >= GIGAWORD) {
                attrs.push({
                    attribute: 'Mikrotik-Total-Limit-Gigawords',
                    value: Math.floor(quotaBytes / GIGAWORD),
                });
            }
        }
        return attrs;
    }

    // radreply rows written at provisioning (consumed by the SQL module).
    private buildReplyAttributes(
        username: string,
        activationId: string,
        pkg: typeof packages.$inferSelect,
        sessionSeconds: number,
    ): Array<typeof radreply.$inferInsert> {
        return this.sessionReplyAttributes(
            activationId,
            pkg,
            sessionSeconds,
        ).map(({ attribute, value }) => ({
            username,
            attribute,
            op: '=',
            value: String(value),
        }));
    }

    // rlm_rest authorize response body (FreeRADIUS 3.x syntax): the same
    // attribute set as radreply, list-qualified into the reply list with the
    // default := operator. Values stay typed (integers as JSON numbers) so
    // rlm_rest builds the pairs without string coercion.
    private buildRestReplyAttributes(
        activationId: string,
        pkg: typeof packages.$inferSelect,
        sessionSeconds: number,
    ): RadiusRestReply {
        const reply: RadiusRestReply = {};
        for (const { attribute, value } of this.sessionReplyAttributes(
            activationId,
            pkg,
            sessionSeconds,
        )) {
            reply[`reply:${attribute}`] = { op: ':=', value: [value] };
        }
        return reply;
    }

    private async buildRedirect(
        activationId: string,
        loginRequest: typeof hotspotLoginRequest.$inferSelect | null,
    ): Promise<ActivationRedirect | null> {
        if (!loginRequest?.linkLoginOnly) return null;
        const username = activationUsername(activationId);
        const password = await this.getProvisionedPassword(username);
        if (!password) return null;
        return {
            activationId,
            username,
            password,
            linkLoginOnly: loginRequest.linkLoginOnly,
            dst: loginRequest.linkOrig ?? '',
            mac: loginRequest.mac,
            chapId: loginRequest.extra?.chapId ?? '',
            chapChallenge: loginRequest.extra?.chapChallenge ?? '',
        };
    }

    private async getProvisionedPassword(
        username: string,
    ): Promise<string | null> {
        const [row] = await db
            .select({ value: radcheck.value })
            .from(radcheck)
            .where(
                and(
                    eq(radcheck.username, username),
                    eq(radcheck.attribute, 'Cleartext-Password'),
                ),
            )
            .limit(1);
        return row?.value ?? null;
    }

    private async getActivationByPayment(paymentId: string) {
        const [row] = await db
            .select()
            .from(activatedPackages)
            .where(eq(activatedPackages.packagePaymentId, paymentId))
            .orderBy(desc(activatedPackages.createdAt))
            .limit(1);
        return row ?? null;
    }

    // The login request that started the purchase, carried in the initiating
    // transaction's metadata — it supplies the NAS servlet links for the
    // redirect back to MikroTik.
    private async getLoginRequestForPayment(
        payment: typeof packagePayments.$inferSelect,
    ) {
        if (!payment.transaction) return null;
        const [tx] = await db
            .select({ metadata: transaction.metadata })
            .from(transaction)
            .where(eq(transaction.id, payment.transaction))
            .limit(1);
        const loginRequestId = (
            tx?.metadata as { loginRequestId?: string } | null
        )?.loginRequestId;
        if (!loginRequestId) return null;
        const [row] = await db
            .select()
            .from(hotspotLoginRequest)
            .where(eq(hotspotLoginRequest.id, loginRequestId))
            .limit(1);
        return row ?? null;
    }

    private async getLoginRequestNasIp(
        payment: typeof packagePayments.$inferSelect,
    ): Promise<string | null> {
        const loginRequest = await this.getLoginRequestForPayment(payment);
        if (!loginRequest) return null;
        const [script] = await db
            .select({ wgClientIp: nasSetupScript.wgClientIp })
            .from(nasSetupScript)
            .where(eq(nasSetupScript.nasDeviceId, loginRequest.nasDeviceId))
            .limit(1);
        return script?.wgClientIp ?? null;
    }

    // Replace-or-insert one radreply attribute row (free-format reply
    // attributes such as Session-Timeout that the reconciler maintains).
    private async upsertReplyAttribute(
        username: string,
        attribute: string,
        value: string,
    ): Promise<void> {
        await db.transaction(async (tx) => {
            await tx
                .delete(radreply)
                .where(
                    and(
                        eq(radreply.username, username),
                        eq(radreply.attribute, attribute),
                    ),
                );
            await tx
                .insert(radreply)
                .values({ username, attribute, op: '=', value });
        });
    }

    // Replace-or-insert one radcheck attribute row (check attributes such as
    // Expiration that move on renewal of a stable PPPoE account).
    private async upsertCheckAttribute(
        username: string,
        attribute: string,
        value: string,
    ): Promise<void> {
        await db.transaction(async (tx) => {
            await tx
                .delete(radcheck)
                .where(
                    and(
                        eq(radcheck.username, username),
                        eq(radcheck.attribute, attribute),
                    ),
                );
            await tx.insert(radcheck).values({
                username,
                attribute,
                op: ':=',
                value,
            });
        });
    }

    // --- Session-targeted Disconnect / CoA directly to the NAS ---------------
    //
    // Termination and re-authorization go straight to the router's
    // `/radius/incoming` listener (RFC 5176), bypassing the RADIUS server:
    // the NAS is resolved from the session's NAS-IP-Address against the DB
    // (nas_setup_script.wg_client_ip over the WireGuard management tunnel, or
    // nas_device.ip_address) and the packet is signed with that NAS's own
    // shared secret (nas_setup_script.radius_secret).

    // Resolves the DM/CoA target + secret for the NAS that holds a session,
    // keyed on the NAS-IP-Address its accounting carries. Throws when the
    // device is unknown to the DB or has no provisioned secret.
    private async nasTargetForSession(session: SessionInfo): Promise<{
        host: string;
        port: number;
        secret: string;
    }> {
        const [row] = await db
            .select({
                wgClientIp: nasSetupScript.wgClientIp,
                radiusSecret: nasSetupScript.radiusSecret,
                deviceIp: nasDevice.ipAddress,
            })
            .from(nasSetupScript)
            .innerJoin(nasDevice, eq(nasSetupScript.nasDeviceId, nasDevice.id))
            .where(
                or(
                    eq(nasSetupScript.wgClientIp, session.nasIpAddress),
                    eq(nasDevice.ipAddress, session.nasIpAddress),
                ),
            )
            .limit(1);
        if (!row) {
            throw new RadiusError(
                `No NAS device known for session NAS-IP ${session.nasIpAddress}`,
            );
        }
        return {
            // Prefer the WireGuard management tunnel address when the device
            // was provisioned through the setup script.
            host: row.wgClientIp,
            port: this.config.dmPort,
            secret: row.radiusSecret,
        };
    }

    // Identity attributes that let the NAS locate the session.
    private sessionCoaIdentity(
        username: string,
        session: SessionInfo,
    ): RadiusOutAttribute[] {
        const attr: { type: number; value: string | Uint8Array }[] = [
            { type: ATTR.USER_NAME, value: username },
            { type: ATTR.ACCT_SESSION_ID, value: session.acctSessionId },
            {
                type: ATTR.NAS_IP_ADDRESS,
                value: ipv4ToOctets(session.nasIpAddress),
            },
        ];

        if (session.framedIpAddress)
            attr.push({
                type: ATTR.FRAMED_IP_ADDRESS,
                value: ipv4ToOctets(session.framedIpAddress),
            });

        return attr;
    }

    // Terminates a live session by sending a Disconnect-Request directly to
    // the NAS holding it (RouterOS `/radius/incoming`, key Acct-Session-Id).
    // Returns true on Disconnect-ACK.
    private async terminateSessionAtNas(
        username: string,
        session: SessionInfo,
    ): Promise<boolean> {
        const target = await this.nasTargetForSession(session);
        const attrs = this.sessionCoaIdentity(username, session);
        if (session.callingStationId) {
            attrs.push({
                type: ATTR.CALLING_STATION_ID,
                value: session.callingStationId,
            });
        }
        if (session.framedIpAddress) {
            attrs.push({
                type: ATTR.FRAMED_IP_ADDRESS,
                value: ipv4ToOctets(session.framedIpAddress),
            });
        }
        return this.sendDisconnectRequest(target, target.secret, attrs);
    }

    // CoA-Request pushing a new Session-Timeout onto one live session
    // directly at the NAS (caps a time-bank session at its remaining
    // balance; Session-Timeout is one of the attributes RouterOS accepts
    // via CoA). Returns true on CoA-ACK.
    private async coaSessionTimeout(
        username: string,
        session: SessionInfo,
        seconds: number,
    ): Promise<boolean> {
        const target = await this.nasTargetForSession(session);
        const attrs = this.sessionCoaIdentity(username, session);
        attrs.push({ type: ATTR.SESSION_TIMEOUT, value: seconds });
        return this.sendCoARequest(target, target.secret, attrs);
    }

    // Closes an accounting record after a confirmed (ACKed) disconnect:
    // stop time + Admin-Reset cause (RFC 2866 §5.10 terminology, the value
    // FreeRADIUS itself stores for admin kills).
    private async closeSessionRecord(session: SessionInfo): Promise<void> {
        await db
            .update(radacct)
            .set({
                acctstoptime: new Date(),
                acctterminatecause: 'Admin-Reset',
                acctsessiontime: session.seconds,
            })
            .where(
                and(
                    eq(radacct.radacctid, BigInt(session.radacctId)),
                    isNull(radacct.acctstoptime),
                ),
            );
    }

    // =========================================================================
    // Internals — accounting correlation + usage math
    // =========================================================================

    // Accounting rows of an activation. The Class cookie set at
    // authentication is echoed unchanged into every Accounting-Request
    // (RouterOS), so radacct rows correlate by class; matching by username
    // covers rows written by servers that strip Class.
    private async getSessions(opts: {
        username: string;
        activationId: string;
        liveOnly?: boolean;
        limit?: number;
    }): Promise<SessionInfo[]> {
        const match = or(
            eq(radacct.username, opts.username),
            eq(radacct.class, opts.activationId),
        );
        const rows = await db
            .select()
            .from(radacct)
            .where(
                opts.liveOnly
                    ? and(
                          match,
                          isNull(radacct.acctstoptime),
                          // Exclude the activation anchor rows, which were never
                          // started by accounting (no acctstarttime).
                          isNotNull(radacct.acctstarttime),
                      )
                    : match,
            )
            .orderBy(desc(radacct.acctstarttime))
            .limit(opts.limit ?? 200);
        return rows.map((row) => this.sessionInfoFromRow(row));
    }

    private sessionInfoFromRow(row: typeof radacct.$inferSelect): SessionInfo {
        const inputOctets = Number(row.acctinputoctets ?? 0);
        const outputOctets = Number(row.acctoutputoctets ?? 0);
        // Live = started by accounting and not yet stopped; the activation
        // anchor rows (no start record) are never live.
        const live = row.acctstoptime === null && row.acctstarttime !== null;
        const seconds = live
            ? row.acctstarttime
                ? Math.max(0, (Date.now() - row.acctstarttime.getTime()) / 1000)
                : 0
            : Number(row.acctsessiontime ?? 0);
        const totalOctets = inputOctets + outputOctets;
        return {
            radacctId: String(row.radacctid),
            acctSessionId: row.acctsessionid,
            username: row.username ?? '',
            nasIpAddress: row.nasipaddress,
            callingStationId: row.callingstationid,
            framedIpAddress: row.framedipaddress,
            startedAt: row.acctstarttime,
            updatedAt: row.acctupdatetime,
            stoppedAt: row.acctstoptime,
            live,
            seconds: Math.round(seconds),
            inputOctets,
            outputOctets,
            totalOctets,
            terminateCause: row.acctterminatecause,
            avgSpeedBps:
                seconds > 0 ? Math.round((totalOctets * 8) / seconds) : 0,
        };
    }

    private async activationStatusFromRows(
        activationId: string,
        activation: typeof activatedPackages.$inferSelect,
        pkg: typeof packages.$inferSelect,
    ): Promise<ActivationStatus | null> {
        const username =
            pkg.type === 'pppoe'
                ? pppoeUsername(activation.userId)
                : activationUsername(activationId);
        const sessions = await this.getSessions({
            username,
            activationId,
        });
        const liveSessions = sessions.filter((s) => s.live);

        const cumulativeUsed = sessions.reduce((sum, s) => sum + s.seconds, 0);
        const usedSeconds = Math.round(cumulativeUsed);

        let sessionLimitSeconds: number;
        let remainingSeconds: number;
        if (pkg.type === 'pppoe') {
            // PPPoE dialers hold STABLE credentials and their session is
            // capped at the package's expiry date (Session-Timeout set to the
            // time remaining until expiry at activation/renewal), so time is
            // reported against the validity window — not a per-session
            // allowance, and never auto-deactivated for time usage.
            sessionLimitSeconds = Math.max(
                1,
                Math.round(
                    (activation.expireAt.getTime() -
                        activation.activatedAt.getTime()) /
                        1000,
                ),
            );
            remainingSeconds = Math.max(
                0,
                Math.round((activation.expireAt.getTime() - Date.now()) / 1000),
            );
        } else {
            const totalSeconds = pkg.sessionLength * 60;
            // Bank (noExpiry) packages: time is cumulative across sessions
            // within the validity window. Regular packages: per-session
            // allowance.
            sessionLimitSeconds = totalSeconds;
            remainingSeconds = Math.max(
                0,
                Math.round(totalSeconds - cumulativeUsed),
            );
            if (totalSeconds <= cumulativeUsed && liveSessions.length > 0) {
                await radiusClient.deactivateActivation(activationId);
            }
        }

        const octetsUsed = sessions.reduce((sum, s) => sum + s.totalOctets, 0);
        const quotaBytes = (pkg.downloadQuota + pkg.uploadQuota) * 1024;
        const lastActive = sessions.reduce<Date | null>((acc, s) => {
            const latest = s.updatedAt ?? s.startedAt;
            if (!latest) return acc;
            return !acc || latest > acc ? latest : acc;
        }, null);

        return {
            activationId,
            username,
            packageId: pkg.id,
            packageTitle: pkg.title,
            paymentId: activation.packagePaymentId,
            activatedAt: activation.activatedAt,
            expireAt: activation.expireAt,
            expired: activation.expireAt.getTime() < Date.now(),
            sessionLimitSeconds,
            usedSeconds,
            remainingSeconds,
            octetsUsed,
            octetsLimit: quotaBytes > 0 ? quotaBytes : null,
            remainingOctets:
                quotaBytes > 0 ? Math.max(0, quotaBytes - octetsUsed) : null,
            online: liveSessions.length > 0,
            liveSessions,
            avgSpeedBps: liveSessions.length
                ? Math.round(
                      liveSessions.reduce((sum, s) => sum + s.avgSpeedBps, 0) /
                          liveSessions.length,
                  )
                : 0,
            lastActive,
        };
    }

    // =========================================================================
    // Internals — RADIUS packet transport (RFC 2865 / RFC 5176)
    // =========================================================================

    private nextIdentifier(): number {
        this.identifier = (this.identifier + 1) % 256;
        return this.identifier;
    }

    private encodeAttributes(
        attributes: RadiusOutAttribute[],
        papAuthenticator: Buffer | null,
        secret: string,
    ): Buffer {
        const parts: Buffer[] = [];
        for (const attribute of attributes) {
            const data = Buffer.from(attrToOctets(attribute.value));
            if (attribute.vendor !== undefined) {
                // VSA: Type=26, Length=4+2+n, Vendor(4), SubType(1), SubLen(1)
                const inner = Buffer.alloc(6 + data.length);
                inner.writeUInt32BE(attribute.vendor, 0);
                inner[4] = attribute.type & 0xff;
                inner[5] = 2 + data.length;
                data.copy(inner, 6);
                parts.push(this.tlv(ATTR.VENDOR_SPECIFIC, inner));
            } else if (
                attribute.type === ATTR.USER_PASSWORD &&
                papAuthenticator
            ) {
                parts.push(
                    this.tlv(
                        ATTR.USER_PASSWORD,
                        this.encryptPapPassword(data, secret, papAuthenticator),
                    ),
                );
            } else {
                parts.push(this.tlv(attribute.type, data));
            }
        }
        return Buffer.concat(parts);
    }

    private tlv(type: number, data: Buffer): Buffer {
        const buf = Buffer.alloc(2 + data.length);
        buf[0] = type & 0xff;
        buf[1] = 2 + data.length;
        data.copy(buf, 2);
        return buf;
    }

    // RFC 2865 §5.2 — XOR chain keyed with MD5(secret + authenticator).
    private encryptPapPassword(
        password: Buffer,
        secret: string,
        authenticator: Buffer,
    ): Buffer {
        const padded = Buffer.alloc(
            Math.ceil(Math.max(1, password.length) / 16) * 16,
        );
        password.copy(padded);
        const out = Buffer.alloc(padded.length);
        let chain = Buffer.concat([Buffer.from(secret, 'utf8'), authenticator]);
        for (let i = 0; i < padded.length; i += 16) {
            const hash = createHash('md5').update(chain).digest();
            for (let j = 0; j < 16; j++) {
                out[i + j] = padded[i + j]! ^ hash[j]!;
            }
            chain = Buffer.concat([
                Buffer.from(secret, 'utf8'),
                padded.subarray(i, i + 16),
            ]);
        }
        return out;
    }

    // Builds the wire packet with Message-Authenticator and the correct
    // Request-Authenticator per RFC:
    //  - Access-Request: random authenticator (RFC 2865 §3); PAP password is
    //    encrypted with it.
    //  - Disconnect/CoA-Request: Message-Authenticator first (computed with a
    //    zeroed authenticator), then Request-Authenticator =
    //    MD5(Code+ID+Length+16 zero octets+attributes+secret) (RFC 5176 §3);
    //    passwords are not allowed in these packets.
    private buildSignedPacket(
        code: number,
        identifier: number,
        attributes: RadiusOutAttribute[],
        secret: string,
    ): { packet: Buffer; authenticator: Buffer } {
        const isDynamic =
            code === CODE.DISCONNECT_REQUEST || code === CODE.COA_REQUEST;
        if (
            isDynamic &&
            attributes.some((a) => a.type === ATTR.USER_PASSWORD)
        ) {
            throw new RadiusError(
                'User-Password is not valid in Disconnect/CoA requests',
            );
        }

        const randomAuth = isDynamic ? null : randomBytes(16);

        // Attribute block ending in a zeroed Message-Authenticator TLV.
        let attrBytes = this.encodeAttributes(
            attributes,
            randomAuth ?? ZERO_AUTH,
            secret,
        );
        const maOffset = attrBytes.length;
        attrBytes = Buffer.concat([attrBytes, Buffer.alloc(18)]);
        attrBytes[maOffset] = ATTR.MESSAGE_AUTHENTICATOR;
        attrBytes[maOffset + 1] = 18;

        const assemble = (auth: Buffer): Buffer => {
            const header = Buffer.alloc(20);
            header[0] = code;
            header[1] = identifier;
            header.writeUInt16BE(20 + attrBytes.length, 2);
            auth.copy(header, 4);
            return Buffer.concat([header, attrBytes]);
        };

        // Message-Authenticator: HMAC-MD5 over the whole packet with the
        // MA field itself zeroed. Access-Requests sign with the real request
        // authenticator (RFC 3579 §2.3); Disconnect/CoA requests sign with a
        // zeroed authenticator because the real one is derived afterwards
        // (RFC 5176 §3).
        const forMa = assemble(isDynamic ? ZERO_AUTH : randomAuth!);
        const ma = createHmac('md5', secret).update(forMa).digest();
        ma.copy(attrBytes, maOffset + 2);

        // Final request authenticator.
        const authenticator = isDynamic
            ? createHash('md5')
                  .update(
                      Buffer.concat([
                          // Code+ID+Length with zeroed authenticator, then
                          // attributes (incl. final MA), then the secret.
                          assemble(ZERO_AUTH),
                          Buffer.from(secret, 'utf8'),
                      ]),
                  )
                  .digest()
            : randomAuth!;

        return { packet: assemble(authenticator), authenticator };
    }

    private decodeAttributes(packet: Buffer): RadiusInAttribute[] {
        const out: RadiusInAttribute[] = [];
        let offset = 20;
        while (offset + 2 <= packet.length) {
            const type = packet[offset]!;
            const length = packet[offset + 1]!;
            if (length < 2 || offset + length > packet.length) break;
            const data = packet.subarray(offset + 2, offset + length);
            if (type === ATTR.VENDOR_SPECIFIC && data.length >= 6) {
                const vendor = Buffer.from(data.subarray(0, 4)).readUInt32BE(0);
                let inner = 4;
                while (inner + 2 <= data.length) {
                    const subType = data[inner]!;
                    const subLen = data[inner + 1]!;
                    if (subLen < 2 || inner + subLen > data.length) break;
                    out.push({
                        type: subType,
                        vendor,
                        data: data.subarray(inner + 2, inner + subLen),
                    });
                    inner += subLen;
                }
            } else {
                out.push({ type, data });
            }
            offset += length;
        }
        return out;
    }

    // RFC 2865 §3 and RFC 5176 §2.3 use the same response formula:
    // MD5(Code+ID+Length+RequestAuth+ResponseAttrs+Secret).
    private validResponseAuthenticator(
        response: Buffer,
        requestAuthenticator: Buffer,
        secret: string,
    ): boolean {
        const expected = createHash('md5')
            .update(
                Buffer.concat([
                    response.subarray(0, 4),
                    requestAuthenticator,
                    response.subarray(20),
                    Buffer.from(secret, 'utf8'),
                ]),
            )
            .digest();
        return expected.equals(response.subarray(4, 20));
    }

    private async sendPacket(
        code: number,
        target: { host: string; port: number },
        secret: string,
        attributes: RadiusOutAttribute[],
        expectedCodes: Set<number>,
    ): Promise<RadiusReply> {
        const identifier = this.nextIdentifier();
        const { packet, authenticator } = this.buildSignedPacket(
            code,
            identifier,
            attributes,
            secret,
        );

        const attempts = Math.max(1, this.config.retries + 1);
        let lastError: unknown = null;
        for (let attempt = 0; attempt < attempts; attempt++) {
            try {
                const response = await this.udpExchange(
                    packet,
                    target,
                    this.config.timeoutMs,
                );
                if (response.length < 20) {
                    throw new RadiusError('Runt RADIUS response');
                }
                if (response[1] !== identifier) {
                    throw new RadiusError(
                        `RADIUS response identifier mismatch (got ${response[1]}, expected ${identifier})`,
                    );
                }
                if (!expectedCodes.has(response[0]!)) {
                    throw new RadiusError(
                        `Unexpected RADIUS response code ${response[0]}`,
                    );
                }
                if (
                    !this.validResponseAuthenticator(
                        response,
                        authenticator,
                        secret,
                    )
                ) {
                    // A bad response authenticator means a shared-secret
                    // mismatch (RouterOS calls these "bad-replies") — retrying
                    // will not fix it.
                    throw new RadiusError(
                        'RADIUS response authenticator mismatch (check the shared secret)',
                    );
                }
                return {
                    code: response[0]!,
                    attributes: this.decodeAttributes(response),
                };
            } catch (err) {
                lastError = err;
                const message = err instanceof Error ? err.message : '';
                const retriable =
                    message.includes('timed out') ||
                    message.includes('ENOTFOUND') ||
                    message.includes('EAI_AGAIN');
                if (!retriable) throw err;
            }
        }
        throw new RadiusError(
            `No RADIUS response from ${target.host}:${target.port}`,
            lastError,
        );
    }

    private udpExchange(
        packet: Buffer,
        target: { host: string; port: number },
        timeoutMs: number,
    ): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            const socket = dgram.createSocket('udp4');
            const timer = setTimeout(() => {
                socket.close();
                reject(
                    new RadiusError(
                        `RADIUS request to ${target.host}:${target.port} timed out`,
                    ),
                );
            }, timeoutMs);

            socket.once('error', (err) => {
                clearTimeout(timer);
                socket.close();
                reject(err);
            });
            socket.once('message', (msg) => {
                clearTimeout(timer);
                socket.close();
                resolve(Buffer.from(msg));
            });
            socket.send(packet, target.port, target.host, (err) => {
                if (err) {
                    clearTimeout(timer);
                    socket.close();
                    reject(err);
                }
            });
        });
    }
}

export { attrToInt, attrToString };
