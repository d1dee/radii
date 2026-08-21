import { loginSchema, signUpSchema } from '@radii/shared';
import { APIError } from 'better-auth/api';
import { and, eq, gte } from 'drizzle-orm';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import { auth } from '../auth';
import { db } from '../db';
import {
    activatedPackages,
    hotspotLoginRequest,
    nasDevice,
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

app.get('/client', requireAuth, (c) => {
    const user = c.get('user');
    return c.json({
        success: true,
        data: {
            userId: user!.id,
            name: user!.name,
            email: user!.email,
            role: user!.role,
            phoneNumber: (user as { username?: string }).username || '',
            prevPaymentMethods: [] as string[],
        },
    });
});

// --- Device quota status ----------------------------------------------------

app.get('/status', requireAuth, async (c) => {
    try {
        const currentUser = c.get('user');

        const activeSubscriptions = await db.query.activatedPackages.findMany({
            where: and(
                eq(activatedPackages.userId, currentUser.id),
                gte(activatedPackages.expireAt, new Date()),
            ),
            with: { package: true, packagePayment: true },
        });

        return c.json({ success: true, data: activeSubscriptions });
    } catch (err) {
        console.error(err);
        throw err;
    }
});

// --- Orders / payments ------------------------------------------------------

const orderSchema = z.object({
    packageId: z.string().min(8).max(32),
    phoneNumber: z.string().min(10),
});

app.post('/order', requireAuth, async (c) => {
    const parsed = orderSchema.safeParse(await c.req.json());
    if (!parsed.success) {
        return jsonError(c, 400, 'Invalid order payload');
    }

    const pkg = await getPackageById(parsed.data.packageId);

    if (!pkg) return jsonError(c, 404, 'Package not found');

    const currentUser = c.get('user');
    const paymentId = crypto.randomUUID();
    await createPayment({
        id: paymentId,
        userId: currentUser!.id,
        packageId: pkg.id,
        amount: Number(pkg.price),
        phoneNumber: parsed.data.phoneNumber,
    });

    return c.json({
        success: true,
        data: {
            paymentId,
            status: 'pending',
            amount: Number(pkg.price),
            packageId: pkg.id,
        },
    });
});

app.get('/payment/:id', requireAuth, async (c) => {
    const id = c.req.param('id');
    const currentUser = c.get('user');
    const payment = await getPaymentById(id);
    if (!payment || payment.userId !== currentUser!.id) {
        return jsonError(c, 404, 'Payment not found');
    }
    return c.json({
        success: true,
        data: {
            paymentId: payment.id,
            status: payment.status,
            amount: Number(payment.amount),
            packageId: payment.packageId,
        },
    });
});

app.post('/deauth/:deviceQuotaId', requireAuth, async (c) => {
    const deviceQuotaId = c.req.param('deviceQuotaId');
    if (!deviceQuotaId) return jsonError(c, 400, 'Missing device quota id');

    // call radacct deauth

    return c.json({ success: true, data: { deviceQuotaId } });
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
// authenticated. Issues a hotspot credential (radcheck Cleartext-Password
// entry), marks the request completed and returns everything the portal needs
// to re-submit to the NAS servlet login page so the client gets online
// (external authentication flow, see the MikroTik hotspot customisation
// docs). Idempotent for the owning user: re-completing rotates the password.
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

    const username = `HS-${id.replace(/-/g, '').slice(0, 10)}`;
    const password = randomHotspotPassword(12);

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

    return c.json({
        success: true,
        data: {
            linkLoginOnly: loginRequest.linkLoginOnly ?? '',
            dst: loginRequest.linkOrig ?? '',
            username,
            password,
            mac: loginRequest.mac,
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
