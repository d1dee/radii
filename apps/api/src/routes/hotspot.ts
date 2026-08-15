import { loginSchema, signUpSchema } from '@radii/shared';
import { APIError } from 'better-auth/api';
import { and, eq, gte } from 'drizzle-orm';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import { auth } from '../auth';
import { db } from '../db';
import { activatedPackages } from '../db/schema';
import { jsonError, jsonFieldErrors } from '../lib/error';
import {
    createPayment,
    getPackageById,
    getPackagesGroupedByCategory,
} from '../lib/packages';
import { requireAdmin, requireAuth } from '../middleware/auth';
import type { AppContext, AppVariables } from '../types';

const app = new Hono<{ Variables: AppVariables }>();

// --- Packages ---------------------------------------------------------------

app.get('/packages', async (c) => {
    const packages = await getPackagesGroupedByCategory();
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

app.post('/deauth/:deviceQuotaId', requireAuth, async (c) => {
    const deviceQuotaId = c.req.param('deviceQuotaId');
    if (!deviceQuotaId) return jsonError(c, 400, 'Missing device quota id');

    // call radacct deauth

    return c.json({ success: true, data: { deviceQuotaId } });
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
