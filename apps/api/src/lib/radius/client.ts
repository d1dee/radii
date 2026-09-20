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
    exists,
    getTableColumns,
    gte,
    inArray,
    isNotNull,
    isNull,
    ne,
    or,
    sql,
} from 'drizzle-orm';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import * as dgram from 'node:dgram';
import { db } from '../../db';
import { env } from '../../env';
import { apiLogger } from '../../logging';
import { getAdminSettings } from '../adminSettings';
import {
    activatedPackages,
    activationEvents,
    hotspotLoginRequest,
    nasDevice,
    nasSetupScript,
    packagePayments,
    packages,
    pppoeServiceAccounts,
    radacct,
    radcheck,
    radreply,
    transaction,
    userFlag,
} from '../../db/schema';
import {
    bondPppoeAccountToNas,
    getPppoeAccountForActivation,
    getPppoeAccountForPayment,
    getPppoeAccountOwnedByCustomer,
    listPppoeServiceAccounts,
    resolveNasDeviceByIp,
    resolvePppoeServiceAccountByUsername,
} from '../pppoeAccounts';
import {
    activationIsAvailable,
    allowanceForRemainingTime,
    calculateActivationTime,
} from './activationLimits';

const logger = apiLogger.getChild('radius');
const PPPOE_EXPIRED_PROFILE = 'radii-ppp-expired';

function effectiveExpireAt(
    activation: typeof activatedPackages.$inferSelect,
    _pkg: typeof packages.$inferSelect,
): Date {
    return activation.expireAt;
}

function activeActivationCondition() {
    const now = new Date();
    return and(
        isNull(activatedPackages.deactivatedAt),
        gte(activatedPackages.expireAt, now),
    );
}

function isUniqueViolation(error: unknown): boolean {
    const value = error as {
        code?: string;
        cause?: { code?: string; errno?: string | number };
    };
    return (
        value.code === '23505' ||
        value.cause?.code === '23505' ||
        value.cause?.errno === '23505'
    );
}

function activationOwnedByAdmin(adminId?: string) {
    return adminId
        ? exists(
              db
                  .select({ one: sql`1` })
                  .from(packagePayments)
                  .innerJoin(
                      nasDevice,
                      eq(packagePayments.nasDeviceId, nasDevice.id),
                  )
                  .where(
                      and(
                          eq(
                              packagePayments.id,
                              activatedPackages.packagePaymentId,
                          ),
                          eq(nasDevice.ownerId, adminId),
                      ),
                  ),
          )
        : undefined;
}

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
    deactivated: boolean;
    deactivatedAt: Date | null;
    sessionLimitSeconds: number;
    usedSeconds: number;
    // Bank packages report the smaller of their cumulative balance and their
    // calendar validity; expiry packages report wall-clock time to expireAt.
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

function activationStatusIsAvailable(status: ActivationStatus): boolean {
    return activationIsAvailable({
        deactivatedAt: status.deactivatedAt,
        expireAt: status.expireAt,
        remainingSeconds: status.remainingSeconds ?? 0,
        now: new Date(),
    });
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

    private async pppoeUsernameForActivation(
        activationId: string,
    ): Promise<string> {
        const account = await getPppoeAccountForActivation(activationId);
        if (account) return account.username;
        const [legacy] = await db
            .select({ username: radacct.username })
            .from(activatedPackages)
            .innerJoin(
                radacct,
                eq(activatedPackages.radacctId, radacct.radacctid),
            )
            .where(eq(activatedPackages.id, activationId))
            .limit(1);
        if (!legacy?.username)
            throw new RadiusError('Unknown PPPoE service account');
        return legacy.username;
    }

    private async newestActivePppoeActivationId(
        accountId: string,
    ): Promise<string | null> {
        const [activation] = await db
            .select({ id: activatedPackages.id })
            .from(activatedPackages)
            .where(
                and(
                    eq(activatedPackages.pppoeServiceAccountId, accountId),
                    activeActivationCondition(),
                ),
            )
            .orderBy(desc(activatedPackages.activatedAt))
            .limit(1);
        return activation?.id ?? null;
    }

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
            if (existing.deactivatedAt !== null) return null;
            // Bank packages must show the current balance before the client
            // is handed credentials; an exhausted bank gets nothing.
            if (pkg.noExpiry || existing.timeAllowanceSeconds !== null) {
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

        let activation: typeof activatedPackages.$inferSelect;
        try {
            activation = await this.provisionActivation(payment, pkg);
        } catch (error) {
            if (!isUniqueViolation(error)) throw error;
            const raced = await this.getActivationByPayment(payment.id);
            if (!raced) throw error;
            activation = raced;
        }
        const username = activationUsername(activation.id);
        const password = await this.getProvisionedPassword(username);
        if (!password) return null;
        return { activationId: activation.id, username, password };
    }

    // PPPoE provisioning with STABLE per-customer credentials: the RADIUS
    // password is generated once on the customer's first PPPoE purchase and
    // reused for every later package. REST refreshes Access-Accept attributes
    // with Session-Timeout set to the time remaining until package expiry.
    private async ensurePppoeProvisioned(
        payment: typeof packagePayments.$inferSelect,
        pkg: typeof packages.$inferSelect,
    ): Promise<ProvisionedCredentials | null> {
        const existing = await this.getActivationByPayment(payment.id);
        const account = await getPppoeAccountForPayment(payment);
        if (!account || account.status !== 'active') return null;
        const hadActiveActivation =
            (await this.newestActivePppoeActivationId(account.id)) !== null;
        let activation = existing;
        if (!activation) {
            try {
                activation = await this.provisionPppoeActivation(
                    payment,
                    pkg,
                    account,
                );
            } catch (error) {
                if (!isUniqueViolation(error)) throw error;
                activation = await this.getActivationByPayment(payment.id);
                if (!activation) throw error;
            }
        }

        if (activation.deactivatedAt !== null) return null;
        if (effectiveExpireAt(activation, pkg).getTime() <= Date.now()) {
            return null;
        }
        if (pkg.noExpiry || activation.timeAllowanceSeconds !== null) {
            const usage = await this.getBankUsage(activation.id);
            if (!usage || usage.remainingSeconds <= 0) return null;
        }

        const username = account.username;

        // Generate credentials only on the very first PPPoE purchase.
        const password = await this.ensurePppoePassword(username);

        await this.applyPppoeAuthorization(activation, pkg);
        // Captured sessions must reconnect to leave the expired profile, but
        // disconnecting inline tears down the customer's network before the
        // payment-status response reaches the portal. Give the successful
        // response time to reach the browser, then trigger the required
        // idempotent reconnect in the background.
        setTimeout(() => {
            void this.disconnectLivePppoeSessions(
                username,
                hadActiveActivation,
            ).catch((err) =>
                logger.error('Delayed PPPoE reconnect failed', { error: err }),
            );
        }, 1_500);
        return {
            activationId: activation.id,
            username,
            password,
        };
    }

    // (Re-)authorizes the customer's stable PPPoE dialer account from one
    // activation. SQL retains only the password; REST supplies all normal or
    // expired-profile reply attributes after credential verification. This
    // avoids FreeRADIUS's expiration module rejecting calendar-expired users
    // before they can enter the payment walled garden.
    private async applyPppoeAuthorization(
        activation: typeof activatedPackages.$inferSelect,
        pkg: typeof packages.$inferSelect,
    ): Promise<void> {
        if (activation.deactivatedAt !== null) return;
        const account = await getPppoeAccountForActivation(activation.id);
        if (!account || account.status !== 'active') return;
        const username = account.username;
        const selectedId = await this.newestActivePppoeActivationId(account.id);
        if (selectedId !== activation.id) return;

        const expireAt = effectiveExpireAt(activation, pkg);
        await Promise.all([
            db
                .delete(radcheck)
                .where(
                    and(
                        eq(radcheck.username, username),
                        eq(radcheck.attribute, 'Expiration'),
                    ),
                ),
            db.delete(radreply).where(eq(radreply.username, username)),
        ]);

        const usage =
            pkg.noExpiry || activation.timeAllowanceSeconds !== null
                ? await this.getBankUsage(activation.id)
                : null;
        const sessionSeconds = usage
            ? Math.max(
                  1,
                  Math.min(
                      usage.remainingSeconds,
                      Math.round((expireAt.getTime() - Date.now()) / 1000),
                  ),
              )
            : Math.max(1, Math.round((expireAt.getTime() - Date.now()) / 1000));
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
                logger.error('PPPoE re-authorization CoA failed', {
                    nasIpAddress: session.nasIpAddress,
                    error: err,
                }),
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
                    activeActivationCondition(),
                ),
            )
            .orderBy(desc(activatedPackages.activatedAt))
            .limit(5);
        for (const row of rows) {
            if (
                row.pkg.noExpiry ||
                row.activation.timeAllowanceSeconds !== null
            ) {
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
                    activeActivationCondition(),
                ),
            )
            .limit(1);
        if (!row) return null;
        if (row.pkg.noExpiry || row.activation.timeAllowanceSeconds !== null) {
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
    async getUserPackageStatuses(
        userId: string,
        type?: 'hotspot' | 'pppoe',
        pppoeServiceAccountId?: string,
    ) {
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
                    activeActivationCondition(),
                    type ? eq(packages.type, type) : undefined,
                    pppoeServiceAccountId
                        ? eq(
                              activatedPackages.pppoeServiceAccountId,
                              pppoeServiceAccountId,
                          )
                        : undefined,
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
            if (!status || !activationStatusIsAvailable(status)) {
                continue;
            }
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
        nasIpAddresses?: string[],
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
            nasIpAddresses,
        );
    }

    // =========================================================================
    // PPPoE dialer accounts (routes/pppoe.ts)
    // =========================================================================

    // The user's active (non-expired) PPPoE activations together with the
    // SHARED stable dialer credentials of the customer (generated once on the
    // first PPPoE purchase, renewed by later payments). The credentials are
    // healed re-provisioning them if their radcheck row vanished.
    async getPppoeClients(userId: string, tenantAdminId?: string | null) {
        const accounts = await listPppoeServiceAccounts(userId, tenantAdminId);
        const result = [];
        for (const { account, tenantName, nas } of accounts) {
            const rows = await db
                .select({ activation: activatedPackages, pkg: packages })
                .from(activatedPackages)
                .innerJoin(
                    packages,
                    eq(activatedPackages.packageId, packages.id),
                )
                .where(
                    and(
                        eq(activatedPackages.pppoeServiceAccountId, account.id),
                        eq(packages.type, 'pppoe'),
                    ),
                )
                .orderBy(desc(activatedPackages.activatedAt))
                .limit(20);
            const activations: ActivationStatus[] = [];
            for (const row of rows) {
                const status = await this.activationStatusFromRows(
                    row.activation.id,
                    row.activation,
                    row.pkg,
                );
                if (status) activations.push(status);
            }
            const activeActivation = activations.find(
                activationStatusIsAvailable,
            );
            const password = activeActivation
                ? await this.ensurePppoePassword(account.username)
                : await this.getProvisionedPassword(account.username);
            result.push({
                accountId: account.id,
                tenantId: account.tenantAdminId,
                tenantName,
                nasDeviceId: account.nasDeviceId,
                nasName: nas?.name ?? null,
                label: account.label,
                status: account.status,
                username: account.username,
                password,
                online: activations.some((activation) => activation.online),
                lastUsedAt: account.lastUsedAt,
                activations,
            });
        }
        return result.sort(
            (a, b) =>
                Number(
                    Boolean(
                        b.activations.find((v) => !v.expired && !v.deactivated),
                    ),
                ) -
                    Number(
                        Boolean(
                            a.activations.find(
                                (v) => !v.expired && !v.deactivated,
                            ),
                        ),
                    ) ||
                Number(b.online) - Number(a.online) ||
                (b.lastUsedAt?.getTime() ?? 0) - (a.lastUsedAt?.getTime() ?? 0),
        );
    }

    // Rotates the password of the customer's stable PPPoE dialer account
    // (referenced through one of their active activations) and disconnects
    // the live PPP session(s) so the new credential takes effect on the next
    // dial. Returns null when the activation is not this user's, is not a
    // PPPoE package, or is expired.
    async rotatePppoePassword(
        accountId: string,
        userId: string,
    ): Promise<ProvisionedCredentials | null> {
        const account = await getPppoeAccountOwnedByCustomer(accountId, userId);
        if (!account || account.status !== 'active') return null;
        const clients = await this.getPppoeClients(
            userId,
            account.tenantAdminId,
        );
        const client = clients.find((value) => value.accountId === accountId);
        const activation = client?.activations.find((value) => !value.expired);
        if (!activation) return null;

        const username = account.username;
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
        const liveRows = await db
            .select()
            .from(radacct)
            .where(
                and(
                    eq(radacct.username, username),
                    isNull(radacct.acctstoptime),
                    isNotNull(radacct.acctstarttime),
                ),
            );
        for (const row of liveRows) {
            const session = this.sessionInfoFromRow(row);
            if (await this.terminateSessionAtNas(username, session)) {
                await this.closeSessionRecord(session);
            }
        }
        return {
            activationId: activation.activationId,
            username,
            password,
        };
    }

    // Restricted PPPoE sessions carry no activation Class cookie, so renewal
    // must locate them by the stable username rather than the new activation.
    // restrictedOnly limits the sweep to live sessions that dialed under the
    // restricted profile (class NULL), leaving normally authorized sessions of
    // an already-active account untouched.
    private async disconnectLivePppoeSessions(
        username: string,
        restrictedOnly?: boolean,
    ): Promise<number> {
        const liveRows = await db
            .select()
            .from(radacct)
            .where(
                and(
                    eq(radacct.username, username),
                    isNull(radacct.acctstoptime),
                    isNotNull(radacct.acctstarttime),
                    restrictedOnly ? isNull(radacct.class) : undefined,
                ),
            );
        let disconnected = 0;
        for (const row of liveRows) {
            const session = this.sessionInfoFromRow(row);
            try {
                if (await this.terminateSessionAtNas(username, session)) {
                    await this.closeSessionRecord(session);
                    disconnected += 1;
                }
            } catch (err) {
                logger.error('PPPoE disconnect failed', {
                    nasIpAddress: session.nasIpAddress,
                    error: err,
                });
            }
        }
        return disconnected;
    }

    // Admin migration: re-point an account at another NAS device owned by the
    // same admin tenant and cut its live sessions so the customer re-dials
    // through the new router.
    async setPppoeAccountNas(
        accountId: string,
        nasDeviceId: string,
        adminId: string,
    ): Promise<{ username: string; sessionsDisconnected: number }> {
        const [account] = await db
            .select()
            .from(pppoeServiceAccounts)
            .where(
                and(
                    eq(pppoeServiceAccounts.id, accountId),
                    eq(pppoeServiceAccounts.tenantAdminId, adminId),
                ),
            )
            .limit(1);
        if (!account) throw new RadiusError('Unknown PPPoE account');
        const [device] = await db
            .select({ id: nasDevice.id })
            .from(nasDevice)
            .where(
                and(
                    eq(nasDevice.id, nasDeviceId),
                    eq(nasDevice.ownerId, adminId),
                ),
            )
            .limit(1);
        if (!device) throw new RadiusError('Unknown NAS device');
        if (account.nasDeviceId === nasDeviceId) {
            return { username: account.username, sessionsDisconnected: 0 };
        }
        // Closed accounts are excluded from the (customer, NAS) / (NAS, phone)
        // unique indexes, so only open rows on the target NAS can block it.
        await this.assertPppoeNasSlotFree(
            account,
            nasDeviceId,
            'the destination network',
        );
        await db
            .update(pppoeServiceAccounts)
            .set({ nasDeviceId })
            .where(eq(pppoeServiceAccounts.id, accountId));
        const sessionsDisconnected = await this.disconnectLivePppoeSessions(
            account.username,
        );
        return { username: account.username, sessionsDisconnected };
    }

    // Guards the partial unique indexes (customer_user_id, nas_device_id) and
    // (nas_device_id, normalized_phone): both only cover non-closed rows, so a
    // migration or reactivation fails when another open account already holds
    // the customer's or the phone's slot on that NAS.
    private async assertPppoeNasSlotFree(
        account: typeof pppoeServiceAccounts.$inferSelect,
        nasDeviceId: string,
        networkLabel: string,
    ): Promise<void> {
        const onTargetNas = and(
            eq(pppoeServiceAccounts.nasDeviceId, nasDeviceId),
            ne(pppoeServiceAccounts.id, account.id),
            ne(pppoeServiceAccounts.status, 'closed'),
        );
        if (account.customerUserId) {
            const [customerConflict] = await db
                .select({ username: pppoeServiceAccounts.username })
                .from(pppoeServiceAccounts)
                .where(
                    and(
                        onTargetNas,
                        eq(
                            pppoeServiceAccounts.customerUserId,
                            account.customerUserId,
                        ),
                    ),
                )
                .limit(1);
            if (customerConflict) {
                throw new RadiusError(
                    `The customer already has another open PPPoE account (${customerConflict.username}) on ${networkLabel}; close or migrate that account first`,
                );
            }
        }
        const [phoneConflict] = await db
            .select({ username: pppoeServiceAccounts.username })
            .from(pppoeServiceAccounts)
            .where(
                and(
                    onTargetNas,
                    eq(
                        pppoeServiceAccounts.normalizedPhone,
                        account.normalizedPhone,
                    ),
                ),
            )
            .limit(1);
        if (phoneConflict) {
            throw new RadiusError(
                `An open account with the same phone number (${phoneConflict.username}) already exists on ${networkLabel}; close or migrate that account first`,
            );
        }
    }

    // Admin status toggle for a provisioned account. Suspended/closed accounts
    // are rejected at RADIUS authorize and skipped by portal provisioning;
    // suspending or closing cuts live sessions so the change is immediate.
    async setPppoeAccountStatus(
        accountId: string,
        status: 'active' | 'suspended' | 'closed',
        adminId: string,
    ): Promise<{
        username: string;
        status: 'active' | 'suspended' | 'closed';
        sessionsDisconnected: number;
    }> {
        const [account] = await db
            .select()
            .from(pppoeServiceAccounts)
            .where(
                and(
                    eq(pppoeServiceAccounts.id, accountId),
                    eq(pppoeServiceAccounts.tenantAdminId, adminId),
                ),
            )
            .limit(1);
        if (!account) throw new RadiusError('Unknown PPPoE account');
        // Closed accounts are excluded from the (customer, NAS) / (NAS, phone)
        // unique indexes, so another account may have taken the slot while
        // this one was closed; reactivation would violate the index.
        if (account.status === 'closed' && status !== 'closed') {
            if (account.nasDeviceId) {
                await this.assertPppoeNasSlotFree(
                    account,
                    account.nasDeviceId,
                    'this network',
                );
            }
        }
        // Status first so a re-dial racing the disconnect is already rejected.
        await db
            .update(pppoeServiceAccounts)
            .set({ status })
            .where(eq(pppoeServiceAccounts.id, accountId));
        const sessionsDisconnected =
            status === 'active'
                ? 0
                : await this.disconnectLivePppoeSessions(account.username);
        return {
            username: account.username,
            status,
            sessionsDisconnected,
        };
    }

    // Force-cuts the account's live PPP sessions without touching status,
    // credentials or provisioning (the customer can re-dial immediately).
    async disconnectPppoeAccount(
        accountId: string,
        adminId: string,
    ): Promise<{ username: string; sessionsDisconnected: number }> {
        const [account] = await db
            .select()
            .from(pppoeServiceAccounts)
            .where(
                and(
                    eq(pppoeServiceAccounts.id, accountId),
                    eq(pppoeServiceAccounts.tenantAdminId, adminId),
                ),
            )
            .limit(1);
        if (!account) throw new RadiusError('Unknown PPPoE account');
        const sessionsDisconnected = await this.disconnectLivePppoeSessions(
            account.username,
        );
        return { username: account.username, sessionsDisconnected };
    }

    // A wrong-NAS dial is operator-visible state: flag the customer for the
    // owning admin tenant (shown in the admin moderation views) and log the
    // attempt. Unclaimed accounts have no user row to flag, so those are only
    // logged. Deduplicated to one flag per customer per 24h — dialers retry
    // constantly.
    private async notifyPppoeNasMismatch(
        account: typeof pppoeServiceAccounts.$inferSelect,
        device: { id: string; ownerId: string; name: string },
    ): Promise<void> {
        logger.warn('Rejected PPPoE dial through mismatched NAS', {
            nasDeviceId: device.id,
            tenantAdminId: device.ownerId,
        });
        if (!account.customerUserId) return;
        const reason = 'pppoe-nas-mismatch';
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const [recent] = await db
            .select({ id: userFlag.id })
            .from(userFlag)
            .where(
                and(
                    eq(userFlag.userId, account.customerUserId),
                    eq(userFlag.reason, reason),
                    gte(userFlag.createdAt, cutoff),
                ),
            )
            .limit(1);
        if (recent) return;
        await db.insert(userFlag).values({
            userId: account.customerUserId,
            reason,
            note: `PPPoE account ${account.username} tried to dial in via ${device.name} but is assigned to a different network. Use the migrate action to move the line.`,
            createdBy: account.tenantAdminId,
        });
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
        nasIpAddress?: string,
    ): Promise<
        | { verdict: 'unknown' }
        | { verdict: 'deactivated' }
        | { verdict: 'expired' }
        | { verdict: 'exhausted' }
        | { verdict: 'restricted'; attributes: RadiusRestReply }
        | { verdict: 'ok'; attributes: RadiusRestReply }
    > {
        const row = await this.resolveActivationByUsername(username);
        if (!row) return this.restAuthorizePppoe(username, nasIpAddress);
        if (row.activation.deactivatedAt !== null) {
            return { verdict: 'deactivated' };
        }
        const expireAt = effectiveExpireAt(row.activation, row.pkg);
        if (expireAt.getTime() < Date.now()) {
            return { verdict: 'expired' };
        }
        let sessionSeconds = Math.max(
            1,
            Math.round((expireAt.getTime() - Date.now()) / 1000),
        );

        if (row.pkg.noExpiry || row.activation.timeAllowanceSeconds !== null) {
            const sync = await this.syncBankAuthorization(
                row.activation.id,
                row.pkg,
            );
            if (!sync.active) return { verdict: 'exhausted' };
            sessionSeconds = sync.remainingSeconds;
        }

        return {
            verdict: 'ok',
            attributes: this.buildRestReplyAttributes(
                row.activation.id,
                row.pkg,
                sessionSeconds,
            ),
        };
    }

    // Stable PPPoE users use SQL only for password verification. All reply
    // attributes come from REST so calendar-expired credentials can still be
    // accepted into the restricted profile instead of being rejected by the
    // stock expiration module. Idempotent and intentionally scoped through
    // pppoe_service_account so hotspot and operator-managed users are untouched.
    async preparePppoeRestAuthorization(): Promise<void> {
        const pppoeUsernames = db
            .select({ username: pppoeServiceAccounts.username })
            .from(pppoeServiceAccounts);
        await db.transaction(async (tx) => {
            await tx
                .delete(radcheck)
                .where(
                    and(
                        eq(radcheck.attribute, 'Expiration'),
                        inArray(radcheck.username, pppoeUsernames),
                    ),
                );
            await tx
                .delete(radreply)
                .where(inArray(radreply.username, pppoeUsernames));
        });
    }

    // rlm_rest authorize for a stable PPPoE account (PPP-…). Unknown
    // usernames fall through to the remaining authorize modules. A valid
    // stable account with no usable activation (expired/lapsed) is never
    // rejected: it is accepted into the restricted RouterOS profile
    // (Mikrotik-Group = radii-ppp-expired) so the customer can reach payment.
    private async restAuthorizePppoe(
        username: string,
        nasIpAddress?: string,
    ): Promise<
        | { verdict: 'unknown' }
        | { verdict: 'deactivated' }
        | { verdict: 'expired' }
        | { verdict: 'exhausted' }
        | { verdict: 'restricted'; attributes: RadiusRestReply }
        | { verdict: 'ok'; attributes: RadiusRestReply }
    > {
        const account = await resolvePppoeServiceAccountByUsername(username);
        if (!account) {
            return /^PPP-[0-9A-F]{16}$/i.test(username.trim())
                ? { verdict: 'deactivated' }
                : { verdict: 'unknown' };
        }
        if (account.status !== 'active' || !nasIpAddress) {
            return { verdict: 'deactivated' };
        }
        const device = await resolveNasDeviceByIp(nasIpAddress);
        if (!device || device.ownerId !== account.tenantAdminId) {
            return { verdict: 'deactivated' };
        }
        if (account.nasDeviceId === null) {
            // First appearance of these credentials: bond the account to the
            // NAS the session arrived at. This is how admin-provisioned
            // unclaimed lines finalize sign-up — the customer dials, the
            // restricted profile redirects them to the portal, and the
            // account already knows which network it belongs to.
            await bondPppoeAccountToNas(account.id, device.id);
        } else if (account.nasDeviceId !== device.id) {
            await this.notifyPppoeNasMismatch(account, device);
            return { verdict: 'deactivated' };
        }

        const rows = await db
            .select({ activation: activatedPackages, pkg: packages })
            .from(activatedPackages)
            .innerJoin(packages, eq(activatedPackages.packageId, packages.id))
            .where(
                and(
                    eq(activatedPackages.pppoeServiceAccountId, account.id),
                    eq(packages.type, 'pppoe'),
                    activeActivationCondition(),
                ),
            )
            .orderBy(desc(activatedPackages.activatedAt))
            .limit(20);
        for (const row of rows) {
            const expireAt = effectiveExpireAt(row.activation, row.pkg);
            if (expireAt.getTime() < Date.now()) continue;

            let sessionSeconds = Math.max(
                1,
                Math.round((expireAt.getTime() - Date.now()) / 1000),
            );
            if (
                row.pkg.noExpiry ||
                row.activation.timeAllowanceSeconds !== null
            ) {
                const sync = await this.syncBankAuthorization(
                    row.activation.id,
                    row.pkg,
                );
                if (!sync.active) continue;
                sessionSeconds = sync.remainingSeconds;
            }
            await db
                .update(pppoeServiceAccounts)
                .set({ lastUsedAt: new Date() })
                .where(eq(pppoeServiceAccounts.id, account.id));
            return {
                verdict: 'ok',
                attributes: this.buildRestReplyAttributes(
                    row.activation.id,
                    row.pkg,
                    sessionSeconds,
                ),
            };
        }
        if (rows.length > 0) return { verdict: 'exhausted' };
        // Lapsed line: no usable activation left. Never reject here — accept
        // into the restricted RouterOS profile so the customer reaches the
        // payment portal, per the expired-subscriber design. The stable
        // Cleartext-Password is never touched on this path: PPPoE credentials
        // must survive expiry unchanged so the customer's router can re-dial
        // as-is after payment.
        return {
            verdict: 'restricted',
            attributes: {
                'reply:Mikrotik-Group': {
                    op: ':=',
                    value: [PPPOE_EXPIRED_PROFILE],
                },
            },
        };
    }

    // Makes a package unavailable without changing its expiry or allowance.
    // RADIUS provisioning is removed and every live
    // session by sending a session-targeted Disconnect-Request directly to
    // the NAS holding it (keyed on Acct-Session-Id, signed with the NAS's own
    // shared secret). Provisioning removal is authoritative; a missed
    // Disconnect still ends the session at the next Session-Timeout /
    // Idle-Timeout boundary. For PPPoE (stable per-customer credentials) the
    // account survives while the user still has another active activation —
    // it is re-authorized from that one instead of being deleted.
    async deactivateActivation(
        activationId: string,
        opts: {
            markDeactivated?: boolean;
            actorId?: string;
            adminId?: string;
            nasIpAddresses?: string[];
        } = {},
    ): Promise<{
        ok: boolean;
        message: string;
        sessionsFound: number;
        sessionsDisconnected: number;
        failures: Array<{ nasIpAddress: string; reason: string }>;
    }> {
        const [activation] = await db
            .select()
            .from(activatedPackages)
            .where(
                and(
                    eq(activatedPackages.id, activationId),
                    activationOwnedByAdmin(opts.adminId),
                ),
            )
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
        const markDeactivated = opts.markDeactivated ?? true;
        if (markDeactivated && activation.deactivatedAt === null) {
            const deactivatedAt = new Date();
            activation.deactivatedAt = deactivatedAt;
            await db.transaction(async (tx) => {
                await tx
                    .update(activatedPackages)
                    .set({ deactivatedAt })
                    .where(eq(activatedPackages.id, activationId));
                await tx.insert(activationEvents).values({
                    activationId,
                    eventType: 'deactivated',
                    actorType: opts.actorId ? 'admin' : 'system',
                    actorId: opts.actorId ?? null,
                    source: opts.actorId ? 'admin_api' : 'system',
                    metadata: {
                        deactivatedAt: deactivatedAt.toISOString(),
                        expireAt: activation.expireAt.toISOString(),
                        timeAllowanceSeconds: activation.timeAllowanceSeconds,
                    },
                });
            });
        }

        const isPppoe = pkg?.type === 'pppoe';

        const username = isPppoe
            ? await this.pppoeUsernameForActivation(activationId)
            : activationUsername(activationId);
        const liveSessions = await this.getSessions({
            username,
            activationId,
            liveOnly: true,
            nasIpAddresses: opts.nasIpAddresses,
        });

        let sessionsDisconnected = 0;
        const failures: Array<{ nasIpAddress: string; reason: string }> = [];
        const disconnectAll = async () => {
            for (const session of liveSessions) {
                try {
                    const ack = await this.terminateSessionAtNas(
                        username,
                        session,
                        opts.adminId,
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
                        eq(
                            activatedPackages.pppoeServiceAccountId,
                            activation.pppoeServiceAccountId!,
                        ),
                        ne(activatedPackages.id, activationId),
                        eq(packages.type, 'pppoe'),
                        activeActivationCondition(),
                    ),
                )
                .orderBy(desc(activatedPackages.activatedAt))
                .limit(1);
            if (other) {
                await this.applyPppoeAuthorization(other.activation, other.pkg);
            } else {
                // Keep the stable Cleartext-Password in radcheck: an expired
                // customer must still be able to authenticate so REST
                // authorize can place the dial into the expired PPP profile
                // (payment-portal access) instead of rejecting it. Only the
                // reply-side provisioning is removed.
                await db
                    .delete(radreply)
                    .where(eq(radreply.username, username));
            }
        } else {
            await Promise.all([
                db.delete(radcheck).where(eq(radcheck.username, username)),
                db.delete(radreply).where(eq(radreply.username, username)),
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
            activationIds?: string[];
            nasIpAddresses?: string[];
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
                    opts.activationIds
                        ? opts.activationIds.length > 0
                            ? inArray(activatedPackages.id, opts.activationIds)
                            : sql`false`
                        : undefined,
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
                opts.nasIpAddresses,
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

    // Restores an administratively deactivated activation without changing its
    // expiry or time allowance. Expired or exhausted activations must have
    // their limits edited before they can be restored.
    async reactivateActivation(
        activationId: string,
        opts: {
            adminId?: string;
            actorId?: string;
            nasIpAddresses?: string[];
        } = {},
    ): Promise<{
        ok: boolean;
        message: string;
        expireAt: Date | null;
    }> {
        const [row] = await db
            .select({ activation: activatedPackages, pkg: packages })
            .from(activatedPackages)
            .innerJoin(packages, eq(activatedPackages.packageId, packages.id))
            .where(
                and(
                    eq(activatedPackages.id, activationId),
                    activationOwnedByAdmin(opts.adminId),
                ),
            )
            .limit(1);
        if (!row) {
            return { ok: false, message: 'Unknown activation', expireAt: null };
        }

        const { activation, pkg } = row;
        const expireAt = activation.expireAt;
        if (expireAt.getTime() <= Date.now()) {
            return {
                ok: false,
                message: 'The activation expiry must be extended first',
                expireAt,
            };
        }
        const usage =
            pkg.noExpiry || activation.timeAllowanceSeconds !== null
                ? await this.getBankUsage(activationId, opts.nasIpAddresses)
                : null;
        if (usage && usage.remainingSeconds <= 0) {
            return {
                ok: false,
                message: 'The activation time balance must be increased first',
                expireAt,
            };
        }

        const previousDeactivatedAt = activation.deactivatedAt;
        activation.deactivatedAt = null;
        await db.transaction(async (tx) => {
            await tx
                .update(activatedPackages)
                .set({ deactivatedAt: null })
                .where(eq(activatedPackages.id, activationId));
            if (previousDeactivatedAt !== null) {
                await tx.insert(activationEvents).values({
                    activationId,
                    eventType: 'reactivated',
                    actorType: opts.actorId ? 'admin' : 'system',
                    actorId: opts.actorId ?? null,
                    source: opts.actorId ? 'admin_api' : 'system',
                    metadata: {
                        previousDeactivatedAt:
                            previousDeactivatedAt.toISOString(),
                        expireAt: expireAt.toISOString(),
                        timeAllowanceSeconds: activation.timeAllowanceSeconds,
                        remainingSeconds: usage?.remainingSeconds ?? null,
                    },
                });
            }
        });

        if (pkg.type === 'pppoe') {
            const username =
                await this.pppoeUsernameForActivation(activationId);
            await this.ensurePppoePassword(username);
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

        let sessionSeconds = Math.max(
            1,
            Math.round((expireAt.getTime() - Date.now()) / 1000),
        );
        if (usage) {
            sessionSeconds = Math.min(sessionSeconds, usage.remainingSeconds);
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

        return { ok: true, message: 'Activation restored', expireAt };
    }

    // Updates the activation's calendar expiry and its usable online-time
    // balance. The allowance stores accounted usage plus the requested
    // balance, preserving accounting history without mutating old sessions.
    async setActivationLimits(
        activationId: string,
        expireAt: Date,
        remainingSeconds: number,
        opts: {
            adminId?: string;
            actorId?: string;
            nasIpAddresses?: string[];
        } = {},
    ): Promise<{ ok: boolean; message: string }> {
        const [row] = await db
            .select({ activation: activatedPackages, pkg: packages })
            .from(activatedPackages)
            .innerJoin(packages, eq(activatedPackages.packageId, packages.id))
            .where(
                and(
                    eq(activatedPackages.id, activationId),
                    activationOwnedByAdmin(opts.adminId),
                ),
            )
            .limit(1);
        if (!row) return { ok: false, message: 'Unknown activation' };
        const username =
            row.pkg.type === 'pppoe'
                ? await this.pppoeUsernameForActivation(activationId)
                : activationUsername(activationId);
        const sessions = await this.getSessions({
            username,
            activationId,
            nasIpAddresses: opts.nasIpAddresses,
        });
        const usedSeconds = Math.round(
            sessions.reduce((sum, session) => sum + session.seconds, 0),
        );
        const timeAllowanceSeconds = allowanceForRemainingTime(
            usedSeconds,
            remainingSeconds,
        );

        const previousExpireAt = row.activation.expireAt;
        const previousTimeAllowanceSeconds =
            row.activation.timeAllowanceSeconds;
        row.activation.expireAt = expireAt;
        row.activation.timeAllowanceSeconds = timeAllowanceSeconds;
        await db.transaction(async (tx) => {
            await tx
                .update(activatedPackages)
                .set({ expireAt, timeAllowanceSeconds })
                .where(eq(activatedPackages.id, activationId));
            await tx.insert(activationEvents).values({
                activationId,
                eventType: 'limits_adjusted',
                actorType: opts.actorId ? 'admin' : 'system',
                actorId: opts.actorId ?? null,
                source: opts.actorId ? 'admin_api' : 'system',
                metadata: {
                    previousExpireAt: previousExpireAt.toISOString(),
                    expireAt: expireAt.toISOString(),
                    previousTimeAllowanceSeconds,
                    timeAllowanceSeconds,
                    usedSeconds,
                    requestedRemainingSeconds: remainingSeconds,
                },
            });
        });

        if (row.activation.deactivatedAt !== null) {
            return {
                ok: true,
                message:
                    'Activation limits updated; activation remains deactivated',
            };
        }

        if (expireAt.getTime() <= Date.now() || remainingSeconds <= 0) {
            await this.deactivateActivation(activationId, {
                markDeactivated: false,
                actorId: opts.actorId,
                adminId: opts.adminId,
                nasIpAddresses: opts.nasIpAddresses,
            });
            return { ok: true, message: 'Activation limits updated' };
        }

        if (row.pkg.type === 'pppoe') {
            await this.ensurePppoePassword(username);
            await this.applyPppoeAuthorization(row.activation, row.pkg);
            return { ok: true, message: 'Activation limits updated' };
        }

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
        await this.syncBankAuthorization(activationId, row.pkg);
        return { ok: true, message: 'Activation limits updated' };
    }

    // Disconnects one live session (of any user) addressed by its radacct id.
    // Termination goes directly to the NAS holding the session.
    async disconnectSessionByRadacctId(
        radacctId: string,
        adminId: string,
        nasIpAddresses: string[],
    ): Promise<{
        ok: boolean;
        message: string;
    }> {
        const [row] = await db
            .select()
            .from(radacct)
            .where(
                and(
                    eq(radacct.radacctid, BigInt(radacctId)),
                    nasIpAddresses.length > 0
                        ? inArray(radacct.nasipaddress, nasIpAddresses)
                        : sql`false`,
                ),
            )
            .limit(1);
        if (!row) return { ok: false, message: 'Unknown session' };
        if (row.acctstoptime !== null || row.acctstarttime === null) {
            return { ok: false, message: 'Session is not live' };
        }
        const session = this.sessionInfoFromRow(row);
        const username = row.username ?? '';
        try {
            const ack = await this.terminateSessionAtNas(
                username,
                session,
                adminId,
            );
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
        opts: {
            adminId: string;
            actorId?: string;
            nasIpAddresses: string[];
        },
    ): Promise<{ ok: boolean; message: string }> {
        const [row] = await db
            .select()
            .from(radacct)
            .where(
                and(
                    eq(radacct.radacctid, BigInt(radacctId)),
                    opts.nasIpAddresses.length > 0
                        ? inArray(radacct.nasipaddress, opts.nasIpAddresses)
                        : sql`false`,
                ),
            )
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
                opts.adminId,
            );
            if (!ack) {
                return { ok: false, message: 'NAS answered CoA-NAK' };
            }
            if (
                row.class &&
                /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                    row.class,
                )
            ) {
                const [ownedActivation] = await db
                    .select({ id: activatedPackages.id })
                    .from(activatedPackages)
                    .where(
                        and(
                            eq(activatedPackages.id, row.class),
                            activationOwnedByAdmin(opts.adminId),
                        ),
                    )
                    .limit(1);
                if (ownedActivation) {
                    await db.insert(activationEvents).values({
                        activationId: ownedActivation.id,
                        eventType: 'session_timeout_adjusted',
                        actorType: opts.actorId ? 'admin' : 'system',
                        actorId: opts.actorId ?? null,
                        source: opts.actorId ? 'admin_api' : 'system',
                        metadata: {
                            radacctId,
                            sessionTimeoutSeconds: Math.max(
                                1,
                                Math.round(seconds),
                            ),
                        },
                    });
                }
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
    async getPppoeCredentialsForUser(userId: string, adminId: string) {
        const rows = await listPppoeServiceAccounts(userId, adminId);
        return Promise.all(
            rows.map(async ({ account, nas }) => ({
                id: account.id,
                label: account.label,
                status: account.status,
                username: account.username,
                password: await this.getProvisionedPassword(account.username),
                nasDeviceId: account.nasDeviceId,
                nasName: nas?.name ?? null,
                lastUsedAt: account.lastUsedAt,
            })),
        );
    }

    // Sets the customer's stable PPPoE dialer password (a random one when
    // omitted — the admin "rotate" flow) and disconnects live PPP sessions so
    // the new credential takes effect on the next dial.
    async setPppoePassword(
        accountId: string,
        password?: string,
        adminId?: string,
        nasIpAddresses: string[] = [],
    ): Promise<{
        username: string;
        password: string;
        sessionsDisconnected: number;
    }> {
        if (!adminId) throw new RadiusError('Unknown PPPoE account');
        const [account] = await db
            .select()
            .from(pppoeServiceAccounts)
            .where(
                and(
                    eq(pppoeServiceAccounts.id, accountId),
                    eq(pppoeServiceAccounts.tenantAdminId, adminId),
                ),
            )
            .limit(1);
        if (!account) {
            throw new RadiusError('Unknown PPPoE account');
        }
        const username = account.username;
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
        const liveRows =
            nasIpAddresses.length > 0
                ? await db
                      .select()
                      .from(radacct)
                      .where(
                          and(
                              eq(radacct.username, username),
                              isNull(radacct.acctstoptime),
                              isNotNull(radacct.acctstarttime),
                              inArray(radacct.nasipaddress, nasIpAddresses),
                          ),
                      )
                : [];
        const liveSessions = liveRows.map((row) =>
            this.sessionInfoFromRow(row),
        );
        let sessionsDisconnected = 0;
        for (const session of liveSessions) {
            try {
                if (
                    await this.terminateSessionAtNas(username, session, adminId)
                ) {
                    sessionsDisconnected++;
                    await this.closeSessionRecord(session);
                }
            } catch (err) {
                logger.error('PPPoE password-change disconnect failed', {
                    nasIpAddress: session.nasIpAddress,
                    error: err,
                });
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
    async getNetworkUsage(
        windowMinutes: number,
        nasIpAddresses: string[],
    ): Promise<NetworkUsage> {
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
                    nasIpAddresses.length > 0
                        ? inArray(radacct.nasipaddress, nasIpAddresses)
                        : sql`false`,
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
            .where(
                and(
                    gte(radacct.acctstarttime, windowStart),
                    nasIpAddresses.length > 0
                        ? inArray(radacct.nasipaddress, nasIpAddresses)
                        : sql`false`,
                ),
            );

        const topUsers = await db
            .select({
                username: radacct.username,
                octets: sql<number>`coalesce(sum(${radacct.acctinputoctets} + ${radacct.acctoutputoctets}), 0)::float8`,
                sessions: sql<number>`count(*)`,
            })
            .from(radacct)
            .where(
                and(
                    gte(radacct.acctstarttime, windowStart),
                    nasIpAddresses.length > 0
                        ? inArray(radacct.nasipaddress, nasIpAddresses)
                        : sql`false`,
                ),
            )
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

    // Session board for admins (most recent first). Exclude anchor rows, which
    // are activation placeholders and were never started by accounting.
    async getAdminSessions(
        nasIpAddresses: string[],
        limit = 100,
    ): Promise<SessionInfo[]> {
        if (nasIpAddresses.length === 0) return [];
        const rows = await db
            .select()
            .from(radacct)
            .where(
                and(
                    isNotNull(radacct.acctstarttime),
                    inArray(radacct.nasipaddress, nasIpAddresses),
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
    async isCredentialOwnedByAdmin(
        username: string,
        adminId: string,
    ): Promise<boolean> {
        const activation = await this.resolveActivationByUsername(username);
        if (activation) {
            const [row] = await db
                .select({ ownerId: nasDevice.ownerId })
                .from(activatedPackages)
                .innerJoin(
                    packagePayments,
                    eq(activatedPackages.packagePaymentId, packagePayments.id),
                )
                .innerJoin(
                    nasDevice,
                    eq(packagePayments.nasDeviceId, nasDevice.id),
                )
                .where(eq(activatedPackages.id, activation.activation.id))
                .limit(1);
            return row?.ownerId === adminId;
        }

        const account = await resolvePppoeServiceAccountByUsername(username);
        return account?.tenantAdminId === adminId;
    }

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
    // TOTAL minutes consumable across sessions within the configurable validity
    // window. Usage = closed sessions' Acct-Session-Time + live sessions' elapsed
    // time (accounting interim updates keep the closed-figure side fresh).
    async getBankUsage(
        activationId: string,
        nasIpAddresses?: string[],
    ): Promise<{
        totalSeconds: number;
        usedSeconds: number;
        remainingSeconds: number;
        username: string;
        expireAt: Date;
        deactivated: boolean;
    } | null> {
        const [row] = await db
            .select({ activation: activatedPackages, pkg: packages })
            .from(activatedPackages)
            .innerJoin(packages, eq(activatedPackages.packageId, packages.id))
            .where(eq(activatedPackages.id, activationId))
            .limit(1);
        if (!row) return null;

        const totalSeconds =
            row.activation.timeAllowanceSeconds ?? row.pkg.sessionLength * 60;
        const username =
            row.pkg.type === 'pppoe'
                ? await this.pppoeUsernameForActivation(activationId)
                : activationUsername(activationId);
        const sessions = await this.getSessions({
            username,
            activationId,
            nasIpAddresses,
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
            username,
            expireAt: effectiveExpireAt(row.activation, row.pkg),
            deactivated: row.activation.deactivatedAt !== null,
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
        const usage = await this.getBankUsage(activationId);
        const username = usage?.username ?? activationUsername(activationId);
        const remainingSeconds = usage?.remainingSeconds ?? 0;
        if (!usage || usage.deactivated) {
            return { active: false, remainingSeconds };
        }
        const account = await getPppoeAccountForActivation(activationId);
        if (account) {
            const selectedId = await this.newestActivePppoeActivationId(
                account.id,
            );
            if (selectedId !== null && selectedId !== activationId) {
                return {
                    active:
                        remainingSeconds > 0 &&
                        usage.expireAt.getTime() > Date.now(),
                    remainingSeconds,
                };
            }
        }
        const liveSessions = await this.getSessions({
            username,
            activationId,
            liveOnly: true,
        });

        if (remainingSeconds <= 0 || usage.expireAt.getTime() <= Date.now()) {
            await this.deactivateActivation(activationId, {
                markDeactivated: false,
            });
            return { active: false, remainingSeconds: 0 };
        }

        const enforcedSeconds = Math.min(
            remainingSeconds,
            Math.max(
                1,
                Math.round((usage.expireAt.getTime() - Date.now()) / 1000),
            ),
        );
        await this.upsertReplyAttribute(
            username,
            'Session-Timeout',
            String(enforcedSeconds),
        );
        await this.upsertCheckAttribute(
            username,
            'Expiration',
            dayjs(usage.expireAt).format('DD MMM YYYY HH:mm:ss'),
        );
        for (const session of liveSessions) {
            await this.coaSessionTimeout(
                username,
                session,
                enforcedSeconds,
            ).catch((err) =>
                logger.error('Time-bank CoA failed', {
                    nasIpAddress: session.nasIpAddress,
                    error: err,
                }),
            );
        }
        return { active: true, remainingSeconds: enforcedSeconds };
    }

    // Periodic bank reconciliation keeps both hotspot and PPPoE bank balances
    // synchronized with their live Session-Timeout caps.
    async reconcileBankPackages(): Promise<number> {
        const rows = await db
            .select({ activation: activatedPackages, pkg: packages })
            .from(activatedPackages)
            .innerJoin(packages, eq(activatedPackages.packageId, packages.id))
            .where(
                and(
                    isNull(activatedPackages.deactivatedAt),
                    or(
                        eq(packages.noExpiry, true),
                        isNotNull(activatedPackages.timeAllowanceSeconds),
                    ),
                ),
            )
            .orderBy(desc(activatedPackages.activatedAt));

        let touched = 0;
        for (const row of rows) {
            try {
                if (
                    effectiveExpireAt(row.activation, row.pkg).getTime() <=
                    Date.now()
                ) {
                    await this.deactivateActivation(row.activation.id, {
                        markDeactivated: false,
                    });
                    touched++;
                    continue;
                }
                await this.syncBankAuthorization(row.activation.id, row.pkg);
                touched++;
            } catch (err) {
                logger.error('Time-bank activation reconciliation failed', {
                    activationId: row.activation.id,
                    error: err,
                });
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

    // Validity window (months) for a cumulative time-bank (noExpiry)
    // activation: the owning admin's packages.noExpiryValidityMonths console
    // setting, falling back to the server env default when unset.
    private async noExpiryValidityMonths(
        payment: typeof packagePayments.$inferSelect,
        pkg: typeof packages.$inferSelect,
    ): Promise<number> {
        const adminId = payment.tenantAdminId ?? pkg.createdBy;
        if (adminId) {
            const settings = await getAdminSettings(adminId);
            const months = settings.packages.noExpiryValidityMonths;
            if (months) return months;
        }
        return env.packages.noExpiryValidityMonths;
    }

    private async provisionActivation(
        payment: typeof packagePayments.$inferSelect,
        pkg: typeof packages.$inferSelect,
    ) {
        const expireAt = pkg.noExpiry
            ? dayjs().add(
                  await this.noExpiryValidityMonths(payment, pkg),
                  'month',
              )
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
                    op: ':=' as const,
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
            await tx.insert(activationEvents).values({
                activationId: row!.id,
                eventType: 'created',
                actorType: 'customer',
                actorId: payment.userId,
                source: 'payment_activation',
                metadata: {
                    paymentId: payment.id,
                    packageId: pkg.id,
                    packageType: pkg.type,
                    expireAt: row!.expireAt.toISOString(),
                    timeAllowanceSeconds: pkg.noExpiry
                        ? pkg.sessionLength * 60
                        : null,
                },
            });
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
        account: typeof pppoeServiceAccounts.$inferSelect,
    ) {
        // PPPoE activations are always calendar-based (no noExpiry): the
        // session length is the validity window from activation.
        const expireAt = dayjs().add(pkg.sessionLength, 'minutes');

        const activationId = randomUUID();
        const username = account.username;

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
                    pppoeServiceAccountId: account.id,
                    activatedAt: new Date(),
                    expireAt: expireAt.toDate(),
                })
                .returning();
            await tx.insert(activationEvents).values({
                activationId: row!.id,
                eventType: 'created',
                actorType: 'customer',
                actorId: payment.userId,
                source: 'payment_activation',
                metadata: {
                    paymentId: payment.id,
                    packageId: pkg.id,
                    packageType: pkg.type,
                    expireAt: row!.expireAt.toISOString(),
                    timeAllowanceSeconds: pkg.noExpiry
                        ? pkg.sessionLength * 60
                        : null,
                },
            });
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

    private async ensurePppoePassword(username: string): Promise<string> {
        const existing = await this.getProvisionedPassword(username);
        if (existing) return existing;

        await db
            .insert(radcheck)
            .values({
                username,
                attribute: 'Cleartext-Password',
                op: ':=',
                value: randomCredentialPassword(12),
            })
            .onConflictDoNothing({
                target: [radcheck.username, radcheck.attribute],
            });

        const persisted = await this.getProvisionedPassword(username);
        if (!persisted) {
            throw new RadiusError(
                `Failed to provision PPPoE password for ${username}`,
            );
        }
        return persisted;
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
    private async nasTargetForSession(
        session: SessionInfo,
        adminId?: string,
    ): Promise<{
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
                and(
                    or(
                        eq(nasSetupScript.wgClientIp, session.nasIpAddress),
                        eq(nasDevice.ipAddress, session.nasIpAddress),
                    ),
                    adminId ? eq(nasDevice.ownerId, adminId) : undefined,
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
        adminId?: string,
    ): Promise<boolean> {
        const target = await this.nasTargetForSession(session, adminId);
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
        adminId?: string,
    ): Promise<boolean> {
        const target = await this.nasTargetForSession(session, adminId);
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
        nasIpAddresses?: string[];
    }): Promise<SessionInfo[]> {
        if (opts.nasIpAddresses?.length === 0) return [];
        const match = opts.username.startsWith('PPP-')
            ? eq(radacct.class, opts.activationId)
            : or(
                  eq(radacct.username, opts.username),
                  eq(radacct.class, opts.activationId),
              );
        const rows = await db
            .select()
            .from(radacct)
            .where(
                and(
                    match,
                    opts.liveOnly ? isNull(radacct.acctstoptime) : undefined,
                    opts.liveOnly
                        ? isNotNull(radacct.acctstarttime)
                        : undefined,
                    opts.nasIpAddresses
                        ? inArray(radacct.nasipaddress, opts.nasIpAddresses)
                        : undefined,
                ),
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
        nasIpAddresses?: string[],
    ): Promise<ActivationStatus | null> {
        const username =
            pkg.type === 'pppoe'
                ? await this.pppoeUsernameForActivation(activationId)
                : activationUsername(activationId);
        const sessions = await this.getSessions({
            username,
            activationId,
            nasIpAddresses,
        });
        const liveSessions = sessions.filter((s) => s.live);

        const cumulativeUsed = sessions.reduce((sum, s) => sum + s.seconds, 0);
        const usedSeconds = Math.round(cumulativeUsed);

        const expireAt = effectiveExpireAt(activation, pkg);
        const { sessionLimitSeconds, remainingSeconds } =
            calculateActivationTime({
                activatedAt: activation.activatedAt,
                expireAt,
                packageAllowanceSeconds: pkg.sessionLength * 60,
                allowanceOverrideSeconds: activation.timeAllowanceSeconds,
                usedSeconds: cumulativeUsed,
                cumulative: pkg.noExpiry,
                now: new Date(),
            });
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
            expireAt,
            expired: expireAt.getTime() < Date.now() || remainingSeconds <= 0,
            deactivated: activation.deactivatedAt !== null,
            deactivatedAt: activation.deactivatedAt,
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
