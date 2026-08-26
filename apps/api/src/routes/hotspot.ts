import {
    loginSchema,
    paymentTransactionCodeSchema,
    signUpSchema,
} from '@radii/shared';
import { APIError } from 'better-auth/api';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import { auth } from '../auth';
import { db } from '../db';
import {
    activatedPackages,
    hotspotLoginRequest,
    nasDevice,
    packagePayments,
    radcheck,
} from '../db/schema';
import { env } from '../env';
import { jsonError, jsonFieldErrors } from '../lib/error';
import {
    createPayment,
    getPackageById,
    getPackagesGroupedByCategory,
    getPaymentById,
} from '../lib/packages';
import { paymentService } from '../lib/payments';
import { radiusClient, type ActivationRedirect } from '../lib/radius';
import { requireAdmin, requireAuth } from '../middleware/auth';
import type { AppContext, AppVariables } from '../types';

const app = new Hono<{ Variables: AppVariables }>();

// --- Packages ---------------------------------------------------------------

// Packages are scoped to the NAS the client connected through: the portal
// passes the login-request id it received on redirect, which carries the
// device id. Packages not linked to that device are not returned.
app.get('/packages', async (c) => {
    const loginRequestId = c.req.query('login_request');
    if (!loginRequestId) {
        return jsonError(c, 400, 'Missing login_request');
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

// --- Authentication (phone + PIN) -------------------------------------------

app.post('/register', async (c) => {
    const parsed = signUpSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
        return jsonFieldErrors(
            c,
            400,
            fieldErrorsFromIssues(parsed.error.issues),
        );
    }

    const { phoneNumber, pin } = parsed.data;

    try {
        const { headers } = await auth.api.signUpEmail({
            body: {
                email: `${normalizePhone(phoneNumber)}@hotspot.local`,
                name: phoneNumber,
                password: pin,
                username: phoneNumber,
            },
            headers: c.req.raw.headers,
            returnHeaders: true,
        });

        return forwardCookies(c, headers, { success: true, data: null });
    } catch (err) {
        return respondAuthError(c, err);
    }
});

app.post('/login', async (c) => {
    const parsed = loginSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
        return jsonFieldErrors(
            c,
            400,
            fieldErrorsFromIssues(parsed.error.issues),
        );
    }

    try {
        const { headers } = await auth.api.signInUsername({
            body: {
                username: parsed.data.phoneNumber,
                password: parsed.data.pin,
            },
            headers: c.req.raw.headers,
            returnHeaders: true,
        });

        return forwardCookies(c, headers, { success: true, data: null });
    } catch (err) {
        return respondAuthError(c, err);
    }
});

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
app.get('/status', requireAuth, async (c) => {
    try {
        const currentUser = c.get('user');

        // Identify the calling device: the portal carries the login-request id
        // it received on redirect (kept in localStorage), and the login
        // request's client MAC is what marks the activation currently running
        // on THIS device (thisDevice) — matched against the MAC the NAS puts
        // into accounting (Calling-Station-Id) for each live session.
        const loginRequestId = c.req.query('login_request');
        let clientMac = '';
        if (loginRequestId) {
            const [loginRequest] = await db
                .select({ mac: hotspotLoginRequest.mac })
                .from(hotspotLoginRequest)
                .where(eq(hotspotLoginRequest.id, loginRequestId))
                .limit(1);
            clientMac = normalizeMac(loginRequest?.mac);
        }

        const activations = await radiusClient.getUserPackageStatuses(
            currentUser!.id,
        );
        const data = activations.map((a) => ({
            deviceQuotaId: a.activationId,
            sessionLength: a.sessionLength,
            // For bank (noExpiry) packages remainingSeconds carries the
            // cumulative balance, so this renders as bank minutes left.
            remainingSessionLength:
                a.remainingSeconds === null
                    ? 0
                    : Math.ceil(a.remainingSeconds / 60),
            price: a.price,
            uploadRate: a.uploadRate,
            downloadRate: a.downloadRate,
            maxDevices: a.maxDevices,
            expiresAt: a.expireAt.toISOString(),
            lastActive: a.lastActive?.toISOString(),
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
            octetsUsed: a.octetsUsed,
            octetsLimit: a.octetsLimit,
            remainingOctets: a.remainingOctets,
            avgSpeedBps: a.avgSpeedBps,
            liveSessions: a.liveSessions,
            bankTotalSeconds: a.bankTotalSeconds,
            bankUsedSeconds: a.bankUsedSeconds,
            bankRemainingSeconds: a.bankRemainingSeconds,
        }));
        return c.json({ success: true, data });
    } catch (err) {
        console.error(err);
        throw err;
    }
});

// --- Orders / payments ------------------------------------------------------

const orderSchema = z.object({
    loginRequestKey: z.uuid().nullable(),
    packageId: z.uuid(),
    phoneNumber: z.string().min(10),
});

app.post('/order', requireAuth, async (c) => {
    const body = await c.req.json();
    const parsed = orderSchema.safeParse(body);
    if (!parsed.success) {
        return jsonError(c, 400, 'Invalid order payload');
    }

    const pkg = await getPackageById(parsed.data.packageId);

    if (!pkg) return jsonError(c, 404, 'Package not found');

    const currentUser = c.get('user');
    const row = await createPayment({
        userId: currentUser!.id,
        packageId: pkg.id,
        amount: Number(pkg.price),
        phoneNumber: parsed.data.phoneNumber,
    });

    // Hand the purchase to the default registered payment provider (gateway
    // specifics live inside the provider; see lib/payments). On failure the
    // payment row stays pending so the customer can retry. The login request
    // is recorded with the transaction so activation can later find the NAS
    // servlet links for the redirect back to MikroTik.
    const initiated = await paymentService.initiatePackagePayment(
        row,
        pkg,
        parsed.data.loginRequestKey,
    );
    if (!initiated.success) {
        return jsonError(c, 502, initiated.message);
    }

    return c.json({
        success: true,
        data: {
            paymentId: row.id,
            status: 'pending',
            amount: Number(pkg.price),
            packageId: pkg.id,
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
        .select()
        .from(packagePayments)
        .where(
            and(
                eq(packagePayments.userId, currentUser!.id),
                eq(packagePayments.status, 'pending'),
            ),
        )
        .orderBy(desc(packagePayments.createdAt))
        .limit(1);

    if (!payment) {
        return c.json({ success: true, data: null });
    }

    const status = await paymentService.refreshPackagePaymentStatus(payment);
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

app.get('/payment/:id', requireAuth, async (c) => {
    const id = c.req.param('id');
    if (!id) {
        return jsonError(c, 404, 'Payment not found');
    }
    const currentUser = c.get('user');
    const payment = await getPaymentById(id);
    if (!payment || payment.userId !== currentUser!.id) {
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
        console.error(
            `[radius] activation for payment ${paymentId} failed:`,
            err,
        );
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
    const result = await paymentService.verifyTransactionCode(
        currentUser!.id,
        parsed.data.transactionCode,
    );

    if (result === null) {
        return jsonError(c, 404, 'Payment not found');
    }
    if (result.error) {
        return jsonError(c, 502, result.message);
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
// terminated by a CoA-Request (keyed on Acct-Session-Id) to the RADIUS server,
// which disconnects it at the NAS, and its accounting record is closed.
// ?session=<radacctId> targets one device; without it every live session of
// the package is disconnected.
app.post('/deauth/:deviceQuotaId', requireAuth, async (c) => {
    const deviceQuotaId = c.req.param('deviceQuotaId');
    if (!deviceQuotaId) return jsonError(c, 400, 'Missing device quota id');

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
    if (activation.userId !== currentUser!.id) {
        return jsonError(c, 404, 'Unknown device quota');
    }

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
        console.error('[radius] session disconnect failed:', err);
        return jsonError(c, 502, 'Could not contact the RADIUS system');
    }
});

// --- External captive portal (NAS login hand-off) ---------------------------

// The branded login page served by each NAS auto-submits every variable the
// RouterOS hotspot servlet exposes at login (client MAC/IP, username, servlet
// links, original destination, error, ...). This endpoint receives that
// submission, persists it, and sends the client's browser on to the portal
// carrying the row id. The portal completes the request after the client
// authenticates (POST /login-request/:id/complete) and re-submits the issued
// hotspot credentials to the NAS servlet login page.
app.post('/login-request', async (c) => {
    const body = await c.req.parseBody();
    const str = (name: string): string => {
        const value = body[name];
        return typeof value === 'string' ? value.trim() : '';
    };

    const nasDeviceId = str('nas');
    const mac = str('mac');
    if (!nasDeviceId || !mac) {
        return jsonError(c, 400, 'Missing nas or mac');
    }
    const [device] = await db
        .select({ id: nasDevice.id })
        .from(nasDevice)
        .where(eq(nasDevice.id, nasDeviceId))
        .limit(1);
    if (!device) {
        return jsonError(c, 404, 'Unknown NAS device');
    }

    const knownFields = new Set([
        'nas',
        'mac',
        'ip',
        'username',
        'linkLogin',
        'linkLoginOnly',
        'linkOrig',
        'error',
    ]);
    const extra: Record<string, string> = {};
    for (const [key, value] of Object.entries(body)) {
        if (knownFields.has(key)) continue;
        if (typeof value === 'string' && value.trim()) {
            extra[key] = value.trim();
        }
    }

    const row = await db
        .insert(hotspotLoginRequest)
        .values({
            nasDeviceId,
            mac,
            ip: str('ip') || null,
            username: str('username') || null,
            linkLogin: str('linkLogin') || null,
            linkLoginOnly: str('linkLoginOnly') || null,
            linkOrig: str('linkOrig') || null,
            error: str('error') || null,
            extra: Object.keys(extra).length > 0 ? extra : null,
        })
        .returning();

    const portalUrl = (env.portalUrl || env.baseUrl).replace(/\/+$/, '');
    return c.redirect(`${portalUrl}/?login_request=${row[0].id}`, 302);
});

const HOTSPOT_CREDENTIAL_CHARS =
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function randomHotspotPassword(length: number): string {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return Array.from(
        bytes,
        (b) => HOTSPOT_CREDENTIAL_CHARS[b % HOTSPOT_CREDENTIAL_CHARS.length]!,
    ).join('');
}

// Called by the portal once the client referenced by the login request has
// authenticated. If the user has an active (paid) package activation, its
// RADIUS credentials are what get sent to the NAS — that login is how the
// package activates on the router. Otherwise a one-off hotspot credential is
// issued (radcheck Cleartext-Password entry) so the client can at least reach
// the portal. Marks the request completed and returns everything the portal
// needs to re-submit to the NAS servlet login page (external authentication
// flow, see the MikroTik hotspot customisation docs).
//
// Body may carry { activationId } to connect one specific device quota
// (the connected-devices screen reconnects an offline activation with it)
// instead of the most recent active one.
app.post('/login-request/:id/complete', requireAuth, async (c) => {
    const id = c.req.param('id');
    if (!id) return jsonError(c, 404, 'Unknown login request');
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

    let username: string;
    let password: string;
    if (active) {
        username = active.username;
        password = active.password;
        await db
            .update(hotspotLoginRequest)
            .set({
                status: 'completed',
                userId: currentUser.id,
                hotspotUsername: username,
            })
            .where(eq(hotspotLoginRequest.id, id));
    } else {
        username = `HS-${id.replace(/-/g, '').slice(0, 10)}`;
        password = randomHotspotPassword(12);

        await db.transaction(async (tx) => {
            await tx.delete(radcheck).where(eq(radcheck.username, username));
            await tx.insert(radcheck).values({
                username,
                attribute: 'Cleartext-Password',
                op: ':=',
                value: password,
            });
            await tx
                .update(hotspotLoginRequest)
                .set({
                    status: 'completed',
                    userId: currentUser.id,
                    hotspotUsername: username,
                })
                .where(eq(hotspotLoginRequest.id, id));
        });
    }

    return c.json({
        success: true,
        data: {
            linkLoginOnly: loginRequest.linkLoginOnly ?? '',
            dst: loginRequest.linkOrig ?? '',
            username,
            password,
            mac: loginRequest.mac,
            activationId: active?.activationId ?? null,
            // Servlet CHAP challenge captured at login-page time; the portal
            // hashes the password with it when both are present (http-chap).
            chapId: loginRequest.extra?.chapId ?? '',
            chapChallenge: loginRequest.extra?.chapChallenge ?? '',
        },
    });
});

// --- Admin ------------------------------------------------------------------

app.get('/users', requireAdmin, async (c) => {
    const data = await auth.api.listUsers({
        query: { limit: 100 },
        headers: c.req.raw.headers,
    });
    return c.json({ success: true, data });
});

// --- Auth helpers -----------------------------------------------------------

function normalizePhone(phone: string) {
    return phone.replace(/\D/g, '');
}

// Compares MACs across formats (AA:BB:.., AA-BB-.., aabb..): hex digits only,
// lowercase.
function normalizeMac(mac: string | null | undefined) {
    return (mac ?? '').toLowerCase().replace(/[^0-9a-f]/g, '');
}

function fieldErrorsFromIssues(
    issues: Array<{ path: Array<unknown>; message: string }>,
): Record<string, string> {
    const out: Record<string, string> = {};
    for (const issue of issues) {
        const key =
            issue.path
                .map((p) =>
                    typeof p === 'object' && p !== null
                        ? String((p as { key?: unknown }).key)
                        : String(p),
                )
                .join('.') || 'form';
        if (!out[key]) out[key] = issue.message;
    }
    return out;
}

function forwardCookies(c: AppContext, headers: Headers, body: unknown) {
    const res = c.json(body);
    for (const cookie of headers.getSetCookie()) {
        res.headers.append('Set-Cookie', cookie);
    }
    return res;
}

function respondAuthError(c: AppContext, err: unknown) {
    if (err instanceof APIError) {
        const code = String(
            (err as { code?: string }).code || '',
        ).toLowerCase();
        const message = (err.message || '').toLowerCase();
        if (
            code.includes('exists') ||
            message.includes('already') ||
            message.includes('exist')
        ) {
            return jsonFieldErrors(
                c,
                409,
                { phoneNumber: 'Phone number already registered' },
                'Phone number already registered',
            );
        }
        if (
            message.includes('password') ||
            message.includes('credential') ||
            message.includes('invalid')
        ) {
            return jsonFieldErrors(
                c,
                401,
                { pin: 'Invalid phone number or PIN' },
                'Invalid phone number or PIN',
            );
        }
        return jsonError(
            c,
            (err.status as ContentfulStatusCode) || 400,
            err.message || 'Authentication failed',
        );
    }
    return jsonError(c, 500, 'Authentication failed');
}

export default app;
