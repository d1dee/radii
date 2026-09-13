// PPPoE customer portal backend — the same purchase/provision/status surface
// as the hotspot portal (routes/hotspot.ts), adapted to PPPoE: there is no
// captive-portal redirect hop, the deliverable of a paid package is the
// RADIUS dialer credentials plus the client configuration the customer needs
// to set up their PPPoE dialer. Authentication, payments and accounting are
// shared with hotspot (same better-auth users, payment service, FreeRADIUS
// SQL provisioning and radacct usage).

import {
    defaultAdminSettings,
    paymentTransactionCodeSchema,
    type PppoeActivation,
} from '@radii/shared';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db';
import {
    activatedPackages,
    nasDevice,
    packagePayments,
    packages,
    user,
} from '../db/schema';
import { env } from '../env';
import {
    loginPhonePin,
    logoutPhonePin,
    registerPhonePin,
} from '../lib/authHelpers';
import {
    getAdminIdForNasDevice,
    getAdminSettings,
} from '../lib/adminSettings';
import { customerVisibleToAdmin } from '../lib/adminUsers';
import { jsonError } from '../lib/error';
import {
    createPayment,
    getPackageById,
    getPackagesGroupedByCategory,
    getPaymentById,
} from '../lib/packages';
import { paymentService } from '../lib/payments';
import { radiusClient } from '../lib/radius';
import { requireAdmin, requireAuth } from '../middleware/auth';
import type { AppVariables } from '../types';

const app = new Hono<{ Variables: AppVariables }>();

// --- Packages ---------------------------------------------------------------

// Packages the portal offers. Unlike hotspot there is no captive-portal
// redirect carrying the NAS id; the portal may optionally scope the listing
// with ?nas=<nasDeviceId> (validated against the device table), otherwise
// every active PPPoE package is returned, grouped by category.
app.get('/packages', async (c) => {
    const nasDeviceId = c.req.query('nas');
    if (nasDeviceId) {
        const [device] = await db
            .select({ id: nasDevice.id })
            .from(nasDevice)
            .where(eq(nasDevice.id, nasDeviceId))
            .limit(1);
        if (!device) {
            return jsonError(c, 404, 'Unknown NAS device');
        }
    }
    const data = await getPackagesGroupedByCategory(
        nasDeviceId ?? null,
        'pppoe',
    );
    return c.json({ success: true, data });
});

// --- Authentication (phone + PIN) -------------------------------------------

app.post('/register', registerPhonePin);

app.post('/login', loginPhonePin);

app.post('/logout', logoutPhonePin);

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

// --- Support contacts ---------------------------------------------------------

// Contact details of the admin owning the NAS the portal is scoped to
// (?nas=<nasDeviceId>, optional like /packages). Public: shown on the
// "Having Issues?" card before and after sign-in. Falls back to empty
// defaults when the portal is not linked to a NAS.
app.get('/contacts', async (c) => {
    const adminId = await getAdminIdForNasDevice(c.req.query('nas'));
    const settings = adminId ? await getAdminSettings(adminId) : null;
    return c.json({
        success: true,
        data: settings?.contacts ?? defaultAdminSettings.contacts,
    });
});

// --- Configuration ----------------------------------------------------------

// Service-level dialer defaults the portal shows next to the credentials
// (service name, MTU/MRU, DNS). Empty service name = the NAS accepts any.
app.get('/config', (c) => {
    return c.json({
        success: true,
        data: {
            serviceName: env.pppoe.serviceName,
            mtu: env.pppoe.mtu,
            mru: env.pppoe.mru,
            dns: env.pppoe.dns,
        },
    });
});

// --- PPPoE clients (dialer accounts) -----------------------------------------

// The caller's active PPPoE dialer accounts with the RADIUS credentials to
// configure on their router/phone dialer, plus live online state.
app.get('/clients', requireAuth, async (c) => {
    const currentUser = c.get('user');
    const clients = await radiusClient.getPppoeClients(currentUser!.id);
    return c.json({
        success: true,
        data: clients.map((client) => ({
            activationId: client.activationId,
            username: client.username,
            password: client.password,
            packageTitle: client.packageTitle,
            activatedAt: client.activatedAt.toISOString(),
            expireAt: client.expireAt.toISOString(),
            online: client.online,
        })),
    });
});

// Full configuration for one dialer: credentials + service defaults, ready to
// copy into the customer's PPPoE client.
app.get('/clients/:id/config', requireAuth, async (c) => {
    const activationId = c.req.param('id');
    if (!activationId) return jsonError(c, 400, 'Missing client id');

    const currentUser = c.get('user');
    const client = (await radiusClient.getPppoeClients(currentUser!.id)).find(
        (v) => v.activationId === activationId,
    );
    if (!client) return jsonError(c, 404, 'Unknown PPPoE client');

    return c.json({
        success: true,
        data: {
            activationId: client.activationId,
            username: client.username,
            password: client.password,
            packageTitle: client.packageTitle,
            expireAt: client.expireAt.toISOString(),
            serviceName: env.pppoe.serviceName,
            mtu: env.pppoe.mtu,
            mru: env.pppoe.mru,
            dns: env.pppoe.dns,
        },
    });
});

// Rotates the dialer's RADIUS password and cuts its live PPP session(s) so
// the new credential takes effect on the next dial. The package stays active.
app.post('/clients/:id/rotate-password', requireAuth, async (c) => {
    const activationId = c.req.param('id');
    if (!activationId) return jsonError(c, 400, 'Missing client id');

    const currentUser = c.get('user');
    try {
        const rotated = await radiusClient.rotatePppoePassword(
            activationId,
            currentUser!.id,
        );
        if (!rotated) {
            return jsonError(
                c,
                404,
                'That PPPoE client is not active anymore — buy a new package.',
            );
        }
        return c.json({
            success: true,
            data: {
                activationId: rotated.activationId,
                username: rotated.username,
                password: rotated.password,
            },
        });
    } catch (err) {
        console.error(
            `[radius] pppoe password rotation failed for ${activationId}:`,
            err,
        );
        return jsonError(c, 502, 'Could not contact the RADIUS system');
    }
});

// --- Status -------------------------------------------------------------------

// Active (non-expired) PPPoE activations enriched with live RADIUS usage:
// remaining time/bytes, live PPP sessions, average speed — everything the
// portal needs to render quota state without talking to RADIUS itself.
app.get('/status', requireAuth, async (c) => {
    const currentUser = c.get('user');
    const activations = await radiusClient.getUserPackageStatuses(
        currentUser!.id,
        'pppoe',
    );
    const data = activations
        .filter((v) => v)
        .map((a) => ({
            id: a.activationId,
            sessionLength: Math.ceil(a.sessionLimitSeconds / 60),
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
            // PPPoE dials directly; there is no portal-side device notion.
            thisDevice: false,
            online: a.online,
            // Surface the NAS-assigned IP (or calling id) of the first live
            // session so the sessions table can identify each dialer.
            clientMac:
                a.liveSessions.find((s) => s.framedIpAddress)
                    ?.framedIpAddress ??
                a.liveSessions.find((s) => s.callingStationId)
                    ?.callingStationId ??
                null,
            packageId: a.packageId,
            packageTitle: a.packageTitle,
            username: a.username,
            usedSeconds: a.usedSeconds,
            sessionLimitSeconds: a.sessionLimitSeconds,
            bankTotalSeconds: a.noExpiry ? a.sessionLength * 60 : null,
            bankUsedSeconds: a.noExpiry ? a.usedSeconds : null,
            bankRemainingSeconds: a.noExpiry
                ? Math.max(0, a.sessionLength * 60 - a.usedSeconds)
                : null,
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
    packageId: z.uuid(),
    phoneNumber: z.string().min(10),
    // The NAS this portal instance is scoped to (captured from ?nas= in the
    // portal URL). Used for tenant attribution of the purchase; when absent
    // the package's NAS links resolve it.
    nas: z.uuid().nullable(),
});

app.post('/order', requireAuth, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = orderSchema.safeParse(body);
    if (!parsed.success) {
        return jsonError(c, 400, 'Invalid order payload');
    }

    const pkg = await getPackageById(parsed.data.packageId);
    if (!pkg) return jsonError(c, 404, 'Package not found');
    if (pkg.type !== 'pppoe') {
        return jsonError(c, 400, 'Package is not a PPPoE package');
    }
    if (!pkg.isActive) {
        return jsonError(c, 400, 'Package is not available');
    }

    const currentUser = c.get('user');

    // Validate the portal-provided NAS before stamping it on the payment.
    let nasDeviceId: string | null = parsed.data.nas ?? null;
    if (nasDeviceId) {
        const [device] = await db
            .select({ id: nasDevice.id })
            .from(nasDevice)
            .where(eq(nasDevice.id, nasDeviceId))
            .limit(1);
        if (!device) {
            return jsonError(c, 400, 'Unknown NAS device');
        }
    }

    const row = await createPayment({
        userId: currentUser!.id,
        packageId: pkg.id,
        amount: Number(pkg.price),
        phoneNumber: parsed.data.phoneNumber,
        nasDeviceId,
    });

    // Hand the purchase to the default registered payment provider. On
    // failure the payment row stays pending so the customer can retry. PPPoE
    // purchases are not tied to a login request (no captive portal), so no
    // redirect metadata is carried in the transaction.
    const initiated = await paymentService.initiatePackagePayment(
        row,
        pkg,
        null,
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
        status === 'paid' ? await pppoeActivationForPayment(payment.id) : null;
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
    const payment = await getPaymentById(id, currentUser!.id);
    if (!payment || payment.userId !== currentUser!.id) {
        return jsonError(c, 404, 'Payment not found');
    }
    // While pending, reconcile against the provider so clients converge even
    // when the gateway webhook has not arrived yet.
    const status = await paymentService.refreshPackagePaymentStatus(payment);
    // Once paid, make sure the package is activated on RADIUS (idempotent)
    // and hand the portal the dialer credentials.
    const activation =
        status === 'paid' ? await pppoeActivationForPayment(payment.id) : null;
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

// Ensures a paid payment has its package activated and returns the dialer
// credentials for the portal. Never fails the request: activation errors
// leave `activation` null and the client keeps polling.
async function pppoeActivationForPayment(
    paymentId: string,
): Promise<PppoeActivation | null> {
    try {
        const provisioned = await radiusClient.ensureProvisioned(paymentId);
        if (!provisioned) return null;
        return {
            activationId: provisioned.activationId,
            username: provisioned.username,
            password: provisioned.password,
        };
    } catch (err) {
        console.error(
            `[radius] pppoe activation for payment ${paymentId} failed:`,
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

    // The payment service activates hotspot-style on its own; for PPPoE the
    // portal needs the dialer credentials, derived here idempotently.
    const activation =
        result.status === 'paid' && result.paymentId
            ? await pppoeActivationForPayment(result.paymentId)
            : null;

    return c.json({
        success: true,
        data: {
            paymentId: result.paymentId ?? '',
            status: result.status,
            message: result.message,
            activation,
        },
    });
});

// Disconnects a dialer's live PPP session of an activated package WITHOUT
// deactivating the package: provisioning stays in the RADIUS tables and the
// activation keeps its validity, so the client can dial straight back in.
// The session is terminated by a Disconnect-Request sent directly to the NAS
// holding it (keyed on Acct-Session-Id), and its accounting record is closed.
// ?session=<radacctId> targets one session; without it every live session of
// the package is disconnected.
app.post('/deauth/:activationId', requireAuth, async (c) => {
    const activationId = c.req.param('activationId');
    if (!activationId) return jsonError(c, 400, 'Missing activation id');

    const currentUser = c.get('user');
    const [activation] = await db
        .select({
            activationId: activatedPackages.id,
            packageType: packages.type,
        })
        .from(activatedPackages)
        .innerJoin(packages, eq(activatedPackages.packageId, packages.id))
        .where(
            and(
                eq(activatedPackages.id, activationId),
                eq(activatedPackages.userId, currentUser!.id),
            ),
        )
        .limit(1);
    if (!activation) return jsonError(c, 404, 'Unknown PPPoE client');
    if (activation.packageType !== 'pppoe') {
        return jsonError(c, 400, 'Activation is not a PPPoE package');
    }

    const sessionId = c.req.query('session') || undefined;
    try {
        const result = await radiusClient.disconnectDeviceSessions(
            activationId,
            { sessionId },
        );
        return c.json({
            success: result.ok,
            message: result.message,
            data: {
                activationId,
                sessionsFound: result.sessionsFound,
                sessionsDisconnected: result.sessionsDisconnected,
            },
        });
    } catch (err) {
        console.error('[radius] pppoe session disconnect failed:', err);
        return jsonError(c, 502, 'Could not contact the RADIUS system');
    }
});

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
