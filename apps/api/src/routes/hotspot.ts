import {
    defaultAdminSettings,
    paymentTransactionCodeSchema,
    zPhoneNumber,
} from '@radii/shared';
import dayjs from 'dayjs';
import {
    and,
    desc,
    eq,
    gt,
    inArray,
    isNull,
    like,
    notExists,
    or,
    sql,
} from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db';
import {
    activatedPackages,
    hotspotLoginRequest,
    nasDevice,
    nasSetupScript,
    packagePayments,
    packages,
    radcheck,
    user,
} from '../db/schema';
import { env } from '../env';
import { getAdminIdForNasDevice, getAdminSettings } from '../lib/adminSettings';
import { customerVisibleToAdmin } from '../lib/adminUsers';
import {
    forgotPinPhoneOtp,
    loginPhonePin,
    logoutPhonePin,
    registerPhonePin,
    resetPinPhoneOtp,
} from '../lib/authHelpers';
import { jsonError } from '../lib/error';
import {
    createPayment,
    getOrderPackageForNas,
    getPackagesGroupedByCategory,
} from '../lib/packages';
import { paymentService } from '../lib/payments';
import { radiusClient, type ActivationRedirect } from '../lib/radius';
import { currentDeviceSessionId, normalizeMac } from '../lib/radius/sessionStatus';
import { hashNasToken, nasTokenMatchesHash } from '../lib/setupScript';
import { deriveNasPortalSecret } from '../lib/setupScriptTemplate';
import { apiLogger } from '../logging';
import { requireAdmin, requireAuth } from '../middleware/auth';
import type { AppVariables } from '../types';

const app = new Hono<{ Variables: AppVariables }>();
const logger = apiLogger.getChild('radius').getChild('hotspot');

// Login requests older than this are dead captive-portal hand-offs: /order
// refuses to claim them, /complete refuses to finish them, and the credential
// sweep treats their one-off HS- radcheck rows as garbage-collectable once
// the short credential Expiration has passed.
export const HOTSPOT_LOGIN_REQUEST_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// Lifetime of a one-off HS- hotspot credential (issued by /complete when the
// customer has no active package). Enforced at auth time by the radcheck
// Expiration row written alongside the Cleartext-Password.
export const HOTSPOT_ONE_OFF_CREDENTIAL_TTL_MS = 12 * 60 * 60 * 1000; // 12h

// Default hotspot servlet DNS name used by the setup script when the admin
// did not configure one (mirrors generateSetupScript's fallback).
const DEFAULT_HOTSPOT_DNS_NAME = 'hotspot.radii.lan';

// Guards raw uuid parameters before they reach Postgres (invalid input would
// otherwise surface as a 500 uuid-cast error).
const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// --- Packages ---------------------------------------------------------------

// Packages are scoped to the NAS the client connected through: the portal
// passes the login-request id it received on redirect, which carries the
// device id. Packages not linked to that device are not returned.
app.get('/packages', async (c) => {
    const loginRequestId = c.req.query('login_request');
    if (!loginRequestId) {
        return jsonError(c, 400, 'Missing login_request');
    }
    if (!UUID_RE.test(loginRequestId)) {
        return jsonError(c, 404, 'Unknown login request');
    }
    const [loginRequest] = await db
        .select({ nasDeviceId: hotspotLoginRequest.nasDeviceId })
        .from(hotspotLoginRequest)
        .where(eq(hotspotLoginRequest.id, loginRequestId))
        .limit(1);
    if (!loginRequest) {
        return jsonError(c, 404, 'Unknown login request');
    }
    const packages = await getPackagesGroupedByCategory(
        loginRequest.nasDeviceId,
    );
    return c.json({ success: true, data: packages });
});

// --- Support contacts ---------------------------------------------------------

// Contact details of the admin owning the NAS the portal is bound to (via the
// login-request id). Public: shown on the "Having Issues?" card before and
// after sign-in. Falls back to empty defaults when the NAS/admin is unknown.
app.get('/contacts', async (c) => {
    const loginRequestId = c.req.query('login_request');
    let nasDeviceId: string | null = null;
    if (loginRequestId && UUID_RE.test(loginRequestId)) {
        const [loginRequest] = await db
            .select({ nasDeviceId: hotspotLoginRequest.nasDeviceId })
            .from(hotspotLoginRequest)
            .where(eq(hotspotLoginRequest.id, loginRequestId))
            .limit(1);
        nasDeviceId = loginRequest?.nasDeviceId ?? null;
    }
    const adminId = await getAdminIdForNasDevice(nasDeviceId);
    const settings = adminId ? await getAdminSettings(adminId) : null;
    return c.json({
        success: true,
        data: settings?.contacts ?? defaultAdminSettings.contacts,
    });
});

// --- Authentication (phone + PIN) -------------------------------------------

app.post('/register', registerPhonePin);

app.post('/login', loginPhonePin);

app.post('/logout', logoutPhonePin);

// Forget-PIN: request a 6-digit SMS code by phone, then redeem it for a new
// 4-digit PIN (authHelpers; OTP delivery see lib/sms.ts).
app.post('/forgot-pin', forgotPinPhoneOtp);

app.post('/reset-pin', resetPinPhoneOtp);

// --- Current user -----------------------------------------------------------

app.get('/client', requireAuth, async (c) => {
    const user = c.get('user');

    // Phones the user has successfully paid with before, most recent first,
    // offered on the buy screen so they don't retype their number.
    const payments = await db
        .select({
            phoneNumber: packagePayments.phoneNumber,
            createdAt: packagePayments.createdAt,
        })
        .from(packagePayments)
        .where(
            and(
                eq(packagePayments.userId, user!.id),
                eq(packagePayments.status, 'paid'),
            ),
        )
        .orderBy(desc(packagePayments.createdAt))
        .limit(20);

    const seen = new Set<string>();
    const prevPaymentMethods: string[] = [];
    for (const payment of payments) {
        const phone = payment.phoneNumber.trim();
        if (phone && !seen.has(phone)) {
            seen.add(phone);
            prevPaymentMethods.push(phone);
        }
    }

    return c.json({
        success: true,
        data: {
            userId: user!.id,
            name: user!.name,
            email: user!.email,
            role: user!.role,
            phoneNumber: (user as { username?: string }).username || '',
            prevPaymentMethods,
        },
    });
});

// --- Device quota status ----------------------------------------------------

// Active (non-expired) package activations enriched with live RADIUS usage:
// remaining time/bytes, live sessions, average speed — everything the portal
// needs to render quota state without talking to RADIUS itself.
// Errors bubble to the global onError handler, which logs them with the
// matched route and request id; no local try/catch to avoid double logging.
app.get('/status', requireAuth, async (c) => {
    const currentUser = c.get('user');

    // Identify the calling device: the portal carries the login-request id in localstorage
    const loginRequestId = c.req.query('login_request');
    let clientMac = '';
    // Optional param: an id that is not a uuid is treated as absent rather
    // than letting the uuid cast surface as a 500.
    if (loginRequestId && UUID_RE.test(loginRequestId)) {
        const [loginRequest] = await db
            .select({ mac: hotspotLoginRequest.mac })
            .from(hotspotLoginRequest)
            .where(eq(hotspotLoginRequest.id, loginRequestId))
            .limit(1);
        clientMac = normalizeMac(loginRequest?.mac);
    }

    const activations = await radiusClient.getUserPackageStatuses(
        currentUser!.id,
        'hotspot',
    );
    const data = activations
        .filter((v) => v)
        .map((a) => ({
            id: a.activationId,
            sessionLength: a.sessionLength,
            // For bank (noExpiry) packages remainingSeconds carries the
            // cumulative balance, so this renders as bank minutes left.
            remainingSessionLength:
                a.remainingSeconds === null
                    ? 0
                    : Math.ceil(a.remainingSeconds / 60),
            remainingSeconds: a.remainingSeconds ?? 0,
            price: a.price,
            uploadRate: a.uploadRate,
            downloadRate: a.downloadRate,
            maxDevices: a.maxDevices,
            expiresAt: a.expireAt.toISOString(),
            lastActive: a.lastActive?.toISOString(),
            noExpiry: a.noExpiry,
            currentSessionId: currentDeviceSessionId(a.liveSessions, clientMac),
            thisDevice:
                clientMac !== '' &&
                a.liveSessions.some(
                    (s) => normalizeMac(s.callingStationId) === clientMac,
                ),
            online: a.online,
            clientMac:
                a.liveSessions.find((s) => s.callingStationId)
                    ?.callingStationId ?? null,
            packageId: a.packageId,
            packageTitle: a.packageTitle,
            username: a.username,
            usedSeconds: a.usedSeconds,
            sessionLimitSeconds: a.sessionLimitSeconds,
            bankTotalSeconds: a.bankTotalSeconds,
            bankUsedSeconds: a.bankUsedSeconds,
            bankRemainingSeconds: a.bankRemainingSeconds,
            octetsUsed: a.octetsUsed,
            octetsLimit: a.octetsLimit,
            remainingOctets: a.remainingOctets,
            avgSpeedBps: a.avgSpeedBps,
            liveSessions: a.liveSessions,
        }));
    return c.json({ success: true, data });
});

// --- Orders / payments ------------------------------------------------------

const orderSchema = z.object({
    loginRequestKey: z.uuid().nullable(),
    packageId: z.uuid(),
    phoneNumber: zPhoneNumber.optional(),
});

app.post('/order', requireAuth, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = orderSchema.safeParse(body);
    if (!parsed.success) {
        return jsonError(c, 400, 'Invalid order payload');
    }

    const currentUser = c.get('user');

    // Tenant attribution: stamp the NAS the purchase happened through. The
    // portal arrives via a login request, so it identifies the device; fall
    // back to the customer's most recent login request when the order does
    // not carry the key.
    let nasDeviceId: string | null = null;
    const freshAfter = new Date(Date.now() - HOTSPOT_LOGIN_REQUEST_TTL_MS);
    const loginRequestId =
        parsed.data.loginRequestKey ??
        (
            await db
                .select({ id: hotspotLoginRequest.id })
                .from(hotspotLoginRequest)
                .where(
                    and(
                        eq(hotspotLoginRequest.userId, currentUser!.id),
                        gt(hotspotLoginRequest.createdAt, freshAfter),
                    ),
                )
                .orderBy(desc(hotspotLoginRequest.createdAt))
                .limit(1)
        )[0]?.id ??
        null;
    if (loginRequestId) {
        // Fresh captive-portal requests are unclaimed until the customer
        // authenticates. Claim the UUID atomically here, while allowing the
        // same customer to reuse it and rejecting requests owned by others
        // or older than the login-request TTL.
        const [lr] = await db
            .update(hotspotLoginRequest)
            .set({ userId: currentUser!.id })
            .where(
                and(
                    eq(hotspotLoginRequest.id, loginRequestId),
                    gt(hotspotLoginRequest.createdAt, freshAfter),
                    or(
                        isNull(hotspotLoginRequest.userId),
                        eq(hotspotLoginRequest.userId, currentUser!.id),
                    ),
                ),
            )
            .returning({ nasDeviceId: hotspotLoginRequest.nasDeviceId });
        nasDeviceId = lr?.nasDeviceId ?? null;
    }
    if (!nasDeviceId) {
        return jsonError(c, 400, 'A valid hotspot login request is required');
    }
    const pkg = await getOrderPackageForNas(
        parsed.data.packageId,
        nasDeviceId,
        'hotspot',
    );
    if (!pkg) return jsonError(c, 404, 'Package not found');
    const isFree = Number(pkg.price) === 0;
    const phoneNumber =
        parsed.data.phoneNumber ??
        (isFree
            ? currentUser!.username?.trim() || currentUser!.email
            : null);
    if (!phoneNumber) {
        return jsonError(c, 400, 'Invalid order payload');
    }

    const row = await createPayment({
        userId: currentUser!.id,
        pkg,
        phoneNumber,
        loginRequestId,
        nasDeviceId,
    });

    if (row.status === 'pending') {
        // Paid purchases retain the existing provider flow. Free purchases
        // are already settled internally and must never reach a provider.
        const initiated = await paymentService.initiatePackagePayment(
            row,
            pkg,
            loginRequestId,
        );
        if (!initiated.success) {
            return jsonError(c, 502, initiated.message);
        }
    }
    const activation =
        row.status === 'paid' ? await activationForPayment(row.id) : null;

    return c.json({
        success: true,
        data: {
            paymentId: row.id,
            status: row.status,
            amount: Number(pkg.price),
            packageId: pkg.id,
            ...(row.status === 'paid' ? { activation } : {}),
        },
    });
});

// The customer's most recent pending payment, used by the portal's "verify
// transaction" flow when the STK push callback never arrived. Reconciles
// against the provider before answering, so a stale pending row converges.
// Must be registered before /payment/:id.
app.get('/payment/pending/latest', requireAuth, async (c) => {
    const currentUser = c.get('user');
    const [payment] = await db
        .select({ payment: packagePayments })
        .from(packagePayments)
        .innerJoin(packages, eq(packagePayments.packageId, packages.id))
        .where(
            and(
                eq(packagePayments.userId, currentUser!.id),
                eq(packagePayments.status, 'pending'),
                eq(packages.type, 'hotspot'),
            ),
        )
        .orderBy(desc(packagePayments.createdAt))
        .limit(1);

    if (!payment) {
        return c.json({ success: true, data: null });
    }

    const status = await paymentService.refreshPackagePaymentStatus(
        payment.payment,
    );
    const activation =
        status === 'paid'
            ? await activationForPayment(payment.payment.id)
            : null;
    return c.json({
        success: true,
        data: {
            paymentId: payment.payment.id,
            status,
            amount: Number(payment.payment.amount),
            packageId: payment.payment.packageId,
            activation,
        },
    });
});

app.get('/payment/:id', requireAuth, async (c) => {
    const id = c.req.param('id');
    if (!id || !UUID_RE.test(id)) {
        return jsonError(c, 404, 'Payment not found');
    }
    const currentUser = c.get('user');
    const [paymentResult] = await db
        .select({ payment: packagePayments })
        .from(packagePayments)
        .innerJoin(packages, eq(packagePayments.packageId, packages.id))
        .where(
            and(
                eq(packagePayments.id, id),
                eq(packagePayments.userId, currentUser.id),
                eq(packages.type, 'hotspot'),
            ),
        )
        .limit(1);
    const payment = paymentResult?.payment;
    if (!payment) {
        return jsonError(c, 404, 'Payment not found');
    }
    // While pending, reconcile against the provider so clients converge even
    // when the gateway webhook has not arrived yet.
    const status = await paymentService.refreshPackagePaymentStatus(payment);
    // Once paid, make sure the package is activated on RADIUS (idempotent)
    // and hand the portal the credentials + NAS servlet link for the final
    // redirect to MikroTik.
    const activation =
        status === 'paid' ? await activationForPayment(payment.id) : null;
    return c.json({
        success: true,
        data: {
            paymentId: payment.id,
            status,
            amount: Number(payment.amount),
            packageId: payment.packageId,
            activation,
        },
    });
});

// Ensures a paid payment has its package activated and returns the redirect
// payload for the portal. Never fails the request: activation errors leave
// `activation` null and the client keeps polling.
async function activationForPayment(
    paymentId: string,
): Promise<ActivationRedirect | null> {
    try {
        return await radiusClient.ensureActivated(paymentId);
    } catch (err) {
        logger.error('Hotspot payment activation failed', {
            paymentId,
            error: err,
        });
        return null;
    }
}

// Verify a gateway transaction code (e.g. M-Pesa receipt) supplied by the
// customer. Idempotent and pollable: known receipts report their current
// state; unknown ones are submitted to the provider and stay 'pending' until
// the provider's status callback arrives, so the client re-posts the same
// code until it leaves pending.
app.post('/payment/:id/verify', requireAuth, async (c) => {
    const id = c.req.param('id');
    const parsed = paymentTransactionCodeSchema.safeParse({
        transactionCode: id ?? '',
    });
    if (!parsed.success) {
        return jsonError(
            c,
            400,
            parsed.error.issues[0]?.message ?? 'Invalid transaction code.',
        );
    }

    const currentUser = c.get('user');
    const loginRequestId = c.req.query('login_request');
    // A malformed id takes the same path as an unknown one: the login request
    // must exist and be owned by the caller.
    if (!loginRequestId || !UUID_RE.test(loginRequestId)) {
        return jsonError(c, 400, 'A valid hotspot login request is required');
    }
    const [loginRequest] = await db
        .select({ nasDeviceId: hotspotLoginRequest.nasDeviceId })
        .from(hotspotLoginRequest)
        .where(
            and(
                eq(hotspotLoginRequest.id, loginRequestId),
                eq(hotspotLoginRequest.userId, currentUser!.id),
            ),
        )
        .limit(1);
    const tenantAdminId = await getAdminIdForNasDevice(
        loginRequest?.nasDeviceId,
    );
    if (!tenantAdminId) {
        return jsonError(c, 400, 'A valid hotspot login request is required');
    }
    const result = await paymentService.verifyTransactionCode(
        currentUser!.id,
        parsed.data.transactionCode,
        tenantAdminId,
        'hotspot',
    );

    if (result === null) {
        return jsonError(c, 404, 'Payment not found');
    }
    if (result.error) {
        return jsonError(c, result.errorStatus ?? 502, result.message);
    }

    return c.json({
        success: true,
        data: {
            paymentId: result.paymentId ?? '',
            status: result.status,
            message: result.message,
            activation: result.activation ?? null,
        },
    });
});

// Disconnects a device's live session of an activated package ("max devices
// full — kick one device" on the connected-devices screen). This does NOT
// deactivate the package: provisioning stays in the RADIUS tables and the
// activation keeps its validity, so the client can log back in. The session is
// terminated by a Disconnect-Request sent directly to the NAS holding it
// (keyed on Acct-Session-Id), and its accounting record is closed.
// ?session=<radacctId> targets one device; without it every live session of
// the package is disconnected.
app.post('/deauth/:deviceQuotaId', requireAuth, async (c) => {
    const deviceQuotaId = c.req.param('deviceQuotaId');
    if (!deviceQuotaId || !UUID_RE.test(deviceQuotaId)) {
        return jsonError(c, 400, 'Missing device quota id');
    }

    const currentUser = c.get('user');
    const [activation] = await db
        .select()
        .from(activatedPackages)
        .where(
            and(
                eq(activatedPackages.id, deviceQuotaId),
                eq(activatedPackages.userId, currentUser.id),
            ),
        )
        .limit(1);
    if (!activation) return jsonError(c, 404, 'Unknown device quota');

    const sessionId = c.req.query('session') || undefined;
    try {
        const result = await radiusClient.disconnectDeviceSessions(
            deviceQuotaId,
            { sessionId },
        );
        return c.json({
            success: result.ok,
            message: result.message,
            data: {
                deviceQuotaId,
                sessionsFound: result.sessionsFound,
                sessionsDisconnected: result.sessionsDisconnected,
            },
        });
    } catch (err) {
        logger.error('Hotspot session disconnect failed', { error: err });
        return jsonError(c, 502, 'Could not contact the RADIUS system');
    }
});

// --- External captive portal (NAS login hand-off) ---------------------------

// The branded login page served by each NAS auto-submits every variable the
// RouterOS hotspot servlet exposes at login (client MAC/IP, username, servlet
// links, original destination, error, ...), following the MikroTik
// "External authentication" hotspot customisation flow. This endpoint receives
// that submission, persists it, and sends the client's browser on to the
// portal carrying the row id. The portal completes the request after the
// client authenticates (POST /login-request/:id/complete) and re-submits the
// issued hotspot credentials to the NAS servlet login page.
//
// Presence binding: the submission must carry the per-device portal secret
// embedded in that NAS's branded login page (deriveNasPortalSecret, verified
// here against the persisted RADIUS secret in constant time). The login page
// is only reachable through the NAS hotspot itself, so a valid secret proves
// the caller actually loaded THIS device's captive portal; remote callers
// cannot forge login requests for foreign tenants (free-package farming,
// attribution poisoning) without first attaching to their network.

const LOGIN_REQUEST_EXTRA_KEYS = ['chapId', 'chapChallenge'] as const;
const LOGIN_REQUEST_EXTRA_MAX_VALUE_LENGTH = 256;
const LOGIN_REQUEST_EXTRA_MAX_TOTAL_LENGTH = 2048;

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
const MAC_RE = /^[0-9a-f]{2}([:-][0-9a-f]{2}){5}$/i;

// IPv4 shape plus octet ranges, so a value that passes can never be
// rejected by the `inet` column on insert.
function isValidIpv4(ip: string): boolean {
    return (
        IPV4_RE.test(ip) && ip.split('.').every((p) => parseInt(p, 10) <= 255)
    );
}

// First usable address of a hotspot network CIDR — the router's hotspot
// gateway, which is the host the servlet puts in $(link-login)/$(link-login-only)
// when no hotspot DNS name is configured.
function hotspotGatewayOf(cidr: string | null): string | null {
    if (!cidr) return null;
    const [ip, prefixRaw] = cidr.split('/');
    const prefixLen = parseInt(prefixRaw ?? '', 10);
    if (!ip || !IPV4_RE.test(ip) || Number.isNaN(prefixLen)) return null;
    const parts = ip.split('.').map((p) => parseInt(p, 10));
    if (parts.some((p) => p > 255)) return null;
    const network =
        (((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>>
            0) &
        ((~0 << (32 - prefixLen)) >>> 0);
    const gateway = (network + 1) >>> 0;
    return [
        (gateway >>> 24) & 0xff,
        (gateway >>> 16) & 0xff,
        (gateway >>> 8) & 0xff,
        gateway & 0xff,
    ].join('.');
}

type NasPortalFacts = {
    ipAddress: string;
    hotspotDnsName: string | null;
    hotspotNetwork: string | null;
    wgClientIp: string | null;
};

// Hosts the servlet may legitimately use in $(link-login)/$(link-login-only):
// the hotspot DNS name (configured or the generator default), the device's
// own addresses, its hotspot gateway and the portal host. Values outside
// this set are attacker-chosen and must never be stored (they are re-used as
// redirect/form targets by the portal and the RADIUS client).
function trustedLoginLinkHosts(nas: NasPortalFacts): Set<string> {
    const hosts = new Set<string>();
    for (const value of [
        nas.hotspotDnsName,
        DEFAULT_HOTSPOT_DNS_NAME,
        // inet columns may carry a CIDR prefix; hosts never do.
        nas.ipAddress.replace(/\/\d+$/, ''),
        nas.hotspotNetwork ? hotspotGatewayOf(nas.hotspotNetwork) : null,
        nas.wgClientIp?.replace(/\/\d+$/, ''),
    ]) {
        if (value) hosts.add(value.toLowerCase());
    }
    try {
        hosts.add(new URL(env.hotspotPortalUrl).hostname.toLowerCase());
    } catch {
        // Unparsable portal URL: skip, the NAS-owned hosts still apply.
    }
    return hosts;
}

// Keeps a servlet link only when it is a plain HTTP(S) URL on a trusted host
// of this NAS; anything else is stored as null.
function sanitizeTrustedLink(raw: string, hosts: Set<string>): string | null {
    if (!raw) return null;
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return hosts.has(url.hostname.toLowerCase()) ? raw : null;
}

// $(link-orig) is the client's own destination: arbitrary by design, but
// only http(s) may be stored so it can never resurface as a javascript:/
// data: redirect target on the portal or the servlet.
function sanitizeLinkOrig(raw: string): string | null {
    if (!raw) return null;
    try {
        const url = new URL(raw);
        return url.protocol === 'http:' || url.protocol === 'https:'
            ? raw
            : null;
    } catch {
        return null;
    }
}

// Fallback servlet login URL for the NAS, used by /complete when the stored
// link-login-only was rejected (or predates host validation) so the portal
// can still re-submit issued credentials to the router.
async function canonicalNasLoginUrl(nasDeviceId: string): Promise<string> {
    const [nas] = await db
        .select({
            ipAddress: nasDevice.ipAddress,
            hotspotDnsName: nasSetupScript.hotspotDnsName,
            hotspotNetwork: nasSetupScript.hotspotNetwork,
        })
        .from(nasDevice)
        .leftJoin(nasSetupScript, eq(nasSetupScript.nasDeviceId, nasDevice.id))
        .where(eq(nasDevice.id, nasDeviceId))
        .limit(1);
    if (!nas) return '';
    const host =
        nas.hotspotDnsName ||
        hotspotGatewayOf(nas.hotspotNetwork) ||
        nas.ipAddress.replace(/\/\d+$/, '');
    return host ? `http://${host}/login` : '';
}

app.post('/login-request', async (c) => {
    const body = await c.req.parseBody();
    const str = (name: string): string => {
        const value = body[name];
        return typeof value === 'string' ? value.trim() : '';
    };

    const nasDeviceId = str('nas');
    const mac = str('mac');
    const portalSecret = str('portalSecret');
    if (!nasDeviceId || !mac) {
        return jsonError(c, 400, 'Missing nas or mac');
    }
    if (!UUID_RE.test(nasDeviceId)) {
        return jsonError(c, 404, 'Unknown NAS device');
    }
    if (!MAC_RE.test(mac)) {
        return jsonError(c, 400, 'Invalid mac');
    }
    const [nas] = await db
        .select({
            ipAddress: nasDevice.ipAddress,
            radiusSecret: nasSetupScript.radiusSecret,
            hotspotDnsName: nasSetupScript.hotspotDnsName,
            hotspotNetwork: nasSetupScript.hotspotNetwork,
            wgClientIp: nasSetupScript.wgClientIp,
        })
        .from(nasDevice)
        .leftJoin(nasSetupScript, eq(nasSetupScript.nasDeviceId, nasDevice.id))
        .where(eq(nasDevice.id, nasDeviceId))
        .limit(1);
    if (!nas) {
        return jsonError(c, 404, 'Unknown NAS device');
    }

    // Presence proof: the login page of THIS NAS embeds its derived portal
    // secret; compare over fixed-length sha256 digests in constant time.
    // Devices without a generated setup script (no radiusSecret, no branded
    // page carrying the secret) fail closed.
    if (
        !portalSecret ||
        !nas.radiusSecret ||
        !nasTokenMatchesHash(
            portalSecret,
            hashNasToken(deriveNasPortalSecret(nas.radiusSecret, nasDeviceId)),
        )
    ) {
        return jsonError(
            c,
            403,
            'Invalid portal secret; reload the hotspot login page',
        );
    }

    const trustedHosts = trustedLoginLinkHosts({
        ipAddress: nas.ipAddress,
        hotspotDnsName: nas.hotspotDnsName,
        hotspotNetwork: nas.hotspotNetwork,
        wgClientIp: nas.wgClientIp,
    });

    // Only the servlet CHAP fields are kept: they are the sole `extra` keys
    // the API reads back (/complete and the RADIUS activation redirect), and
    // both value and total size are capped so the column cannot be stuffed.
    const extra: Record<string, string> = {};
    let extraSize = 0;
    for (const key of LOGIN_REQUEST_EXTRA_KEYS) {
        const value = str(key).slice(0, LOGIN_REQUEST_EXTRA_MAX_VALUE_LENGTH);
        if (!value) continue;
        if (extraSize + value.length > LOGIN_REQUEST_EXTRA_MAX_TOTAL_LENGTH) {
            break;
        }
        extra[key] = value;
        extraSize += value.length;
    }

    const ip = str('ip');

    const row = await db
        .insert(hotspotLoginRequest)
        .values({
            nasDeviceId,
            mac,
            ip: ip && isValidIpv4(ip) ? ip : null,
            username: str('username').slice(0, 256) || null,
            linkLogin: sanitizeTrustedLink(str('linkLogin'), trustedHosts),
            linkLoginOnly: sanitizeTrustedLink(
                str('linkLoginOnly'),
                trustedHosts,
            ),
            linkOrig: sanitizeLinkOrig(str('linkOrig')),
            error: str('error').slice(0, 512) || null,
            extra: Object.keys(extra).length > 0 ? extra : null,
        })
        .returning();

    const portalUrl = env.hotspotPortalUrl.replace(/\/+$/, '');

    return c.redirect(`${portalUrl}/?login_request=${row[0].id}`, 302);
});

const HOTSPOT_CREDENTIAL_CHARS =
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

// Rejection sampling: bytes >= limit would make the first (256 % n)
// characters of the alphabet more likely (modulo bias), so they are
// discarded and redrawn until every character is uniformly probable.
function randomHotspotPassword(length: number): string {
    const limit = 256 - (256 % HOTSPOT_CREDENTIAL_CHARS.length);
    const out: string[] = [];
    while (out.length < length) {
        const bytes = new Uint8Array(length * 2);
        crypto.getRandomValues(bytes);
        for (const byte of bytes) {
            if (byte >= limit) continue;
            out.push(
                HOTSPOT_CREDENTIAL_CHARS[
                    byte % HOTSPOT_CREDENTIAL_CHARS.length
                ]!,
            );
            if (out.length === length) break;
        }
    }
    return out.join('');
}

// Called by the portal once the client referenced by the login request has
// authenticated. If the user has an active (paid) package activation, its
// RADIUS credentials are what get sent to the NAS — that login is how the
// package activates on the router. Otherwise a one-off hotspot credential is
// issued (radcheck Cleartext-Password entry plus an Expiration entry so it
// stops authenticating after HOTSPOT_ONE_OFF_CREDENTIAL_TTL_MS) so the
// client can at least reach the portal. Marks the request completed and
// returns everything the portal needs to re-submit to the NAS servlet login
// page (external authentication flow, see the MikroTik hotspot
// customisation docs).
//
// Body may carry { activationId } to connect one specific device quota
// (the connected-devices screen reconnects an offline activation with it)
// instead of the most recent active one.
app.post('/login-request/:id/complete', requireAuth, async (c) => {
    const id = c.req.param('id');
    if (!id || !UUID_RE.test(id)) {
        return jsonError(c, 404, 'Unknown login request');
    }
    const currentUser = c.get('user');
    if (!currentUser) return jsonError(c, 401, 'Unauthorized');

    const [loginRequest] = await db
        .select()
        .from(hotspotLoginRequest)
        .where(eq(hotspotLoginRequest.id, id))
        .limit(1);
    if (!loginRequest) {
        return jsonError(c, 404, 'Unknown login request');
    }
    if (loginRequest.userId && loginRequest.userId !== currentUser.id) {
        return jsonError(c, 403, 'Login request already completed');
    }
    if (
        loginRequest.createdAt.getTime() <
        Date.now() - HOTSPOT_LOGIN_REQUEST_TTL_MS
    ) {
        return jsonError(
            c,
            410,
            'This hotspot sign-in session has expired — reconnect to the wifi network to start a new one.',
        );
    }

    const body = (await c.req.json().catch(() => ({}))) as {
        activationId?: unknown;
    };
    const requestedActivationId =
        typeof body.activationId === 'string' ? body.activationId : null;

    const active = await (
        requestedActivationId
            ? radiusClient.getActivationCredentials(
                  requestedActivationId,
                  currentUser.id,
              )
            : radiusClient.getActiveActivationCredentials(currentUser.id)
    ).catch(() => null);

    if (requestedActivationId && !active) {
        return jsonError(
            c,
            404,
            'That package is not active anymore — buy a new one to connect.',
        );
    }

    // Losing racer guard: the completion UPDATE is conditional (same pattern
    // as the /order claim), so a concurrent second complete for the same
    // request cannot re-issue credentials or steal an already-owned row.
    const claimWhere = and(
        eq(hotspotLoginRequest.id, id),
        or(
            isNull(hotspotLoginRequest.userId),
            eq(hotspotLoginRequest.userId, currentUser.id),
        ),
    );

    let username: string;
    let password: string;
    if (active) {
        username = active.username;
        password = active.password;
        const [claimed] = await db
            .update(hotspotLoginRequest)
            .set({
                status: 'completed',
                userId: currentUser.id,
                hotspotUsername: username,
            })
            .where(claimWhere)
            .returning({ id: hotspotLoginRequest.id });
        if (!claimed) {
            return jsonError(c, 409, 'Login request already completed');
        }
    } else {
        username = `HS-${id.replace(/-/g, '').slice(0, 10)}`;
        password = randomHotspotPassword(12);

        const claimed = await db.transaction(async (tx) => {
            const [row] = await tx
                .update(hotspotLoginRequest)
                .set({
                    status: 'completed',
                    userId: currentUser.id,
                    hotspotUsername: username,
                })
                .where(claimWhere)
                .returning({ id: hotspotLoginRequest.id });
            if (!row) return null;
            await tx.delete(radcheck).where(eq(radcheck.username, username));
            await tx.insert(radcheck).values([
                {
                    username,
                    attribute: 'Cleartext-Password',
                    op: ':=',
                    value: password,
                },
                {
                    // Same attribute/format the package activations use
                    // ('DD MMM YYYY HH:mm:ss', FreeRADIUS rlm_expiration):
                    // the one-off credential stops authenticating after the
                    // TTL even before the periodic sweep removes the rows.
                    username,
                    attribute: 'Expiration',
                    op: ':=',
                    value: dayjs(
                        Date.now() + HOTSPOT_ONE_OFF_CREDENTIAL_TTL_MS,
                    ).format('DD MMM YYYY HH:mm:ss'),
                },
            ]);
            return row;
        });
        if (!claimed) {
            return jsonError(c, 409, 'Login request already completed');
        }
    }

    // The stored servlet link is host-validated at creation, but rows written
    // before validation existed could still carry an untrusted host until
    // their TTL lapses — re-validate on read with the same helpers, and fall
    // back to the canonical login URL of the NAS so a rejected/nulled/missing
    // value can never leave the portal without a submit target.
    let linkLoginOnly: string | null = null;
    if (loginRequest.linkLoginOnly) {
        const [nas] = await db
            .select({
                ipAddress: nasDevice.ipAddress,
                hotspotDnsName: nasSetupScript.hotspotDnsName,
                hotspotNetwork: nasSetupScript.hotspotNetwork,
                wgClientIp: nasSetupScript.wgClientIp,
            })
            .from(nasDevice)
            .leftJoin(
                nasSetupScript,
                eq(nasSetupScript.nasDeviceId, nasDevice.id),
            )
            .where(eq(nasDevice.id, loginRequest.nasDeviceId))
            .limit(1);
        if (nas) {
            linkLoginOnly = sanitizeTrustedLink(
                loginRequest.linkLoginOnly,
                trustedLoginLinkHosts(nas),
            );
        }
    }
    if (!linkLoginOnly) {
        linkLoginOnly = await canonicalNasLoginUrl(loginRequest.nasDeviceId);
    }

    return c.json({
        success: true,
        data: {
            linkLoginOnly,
            dst: loginRequest.linkOrig ?? '',
            username,
            password,
            mac: loginRequest.mac,
            activationId: active?.activationId ?? null,
            // Servlet CHAP challenge captured at login-page time; the portal
            // hashes the password with it when both are present (http-chap).
            // Whitelisted + length-capped at creation, '' when absent.
            chapId: loginRequest.extra?.chapId ?? '',
            chapChallenge: loginRequest.extra?.chapChallenge ?? '',
        },
    });
});

// Periodic sweep of the one-off HS- hotspot credentials (registered on the
// RADIUS reconciler ticker in lib/radius): removes every radcheck row of a
// username whose Expiration has passed, or whose login request is gone
// (orphaned rows can no longer be attributed and are never legitimate —
// issuance and the request update happen in one transaction). Expired-by-TTL
// login requests land here through their Expiration row, which always
// pre-dates the request TTL.
export async function cleanupExpiredHotspotCredentials(): Promise<void> {
    const deletable = db
        .select({ username: radcheck.username })
        .from(radcheck)
        .where(
            and(
                like(radcheck.username, 'HS-%'),
                or(
                    and(
                        eq(radcheck.attribute, 'Expiration'),
                        sql`${radcheck.value} ~ '^\\d{2} [A-Za-z]{3} \\d{4} \\d{2}:\\d{2}:\\d{2}$'`,
                        sql`to_timestamp(${radcheck.value}, 'DD Mon YYYY HH24:MI:SS') < now()`,
                    ),
                    notExists(
                        db
                            .select({ one: sql`1` })
                            .from(hotspotLoginRequest)
                            .where(
                                eq(
                                    hotspotLoginRequest.hotspotUsername,
                                    radcheck.username,
                                ),
                            ),
                    ),
                ),
            ),
        );
    await db
        .delete(radcheck)
        .where(
            and(
                like(radcheck.username, 'HS-%'),
                inArray(radcheck.username, deletable),
            ),
        );
}

// --- Admin ------------------------------------------------------------------

// Registered portal customers from the customer instance's `user` table,
// scoped to those who interacted with the requesting admin's NAS devices.
// Queried directly: admin sessions live on the separate admin auth instance,
// so the customer instance's session-bound listUsers API cannot be called
// cross-instance.
app.get('/users', requireAdmin, async (c) => {
    const users = await db
        .select({
            id: user.id,
            name: user.name,
            email: user.email,
            username: user.username,
            createdAt: user.createdAt,
            banned: user.banned,
        })
        .from(user)
        .where(customerVisibleToAdmin(c.get('adminSession').userId))
        .orderBy(desc(user.createdAt))
        .limit(100);
    return c.json({
        success: true,
        data: { users, total: users.length, limit: 100, offset: 0 },
    });
});

export default app;
