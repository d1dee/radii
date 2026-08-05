import { loginSchema, Quota, signUpSchema } from '@radii/shared';
import { APIError } from 'better-auth/api';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import { auth } from '../auth';
import { jsonError, jsonFieldErrors } from '../lib/error';
import { PACKAGES } from '../lib/packages';
import { requireAdmin, requireAuth } from '../middleware/auth';
import type { AppContext, AppVariables } from '../types';

const app = new Hono<{ Variables: AppVariables }>();

// --- Packages ---------------------------------------------------------------

// Public: list packages grouped by category.
app.get('/packages', (c) => {
    return c.json({ success: true, data: PACKAGES });
});

// Admin: create a package (persists once the catalog is DB-backed).
const createPackageSchema = z.object({
    title: z.string().min(1),
    category: z.string().min(1),
    initialSessionLength: z.number().int().positive(),
    price: z.number().nonnegative(),
    maxDevices: z.number().int().positive(),
    noExpiry: z.boolean(),
    description: z.string().optional(),
    note: z.string().optional(),
    uploadRate: z.number().nonnegative(),
    downloadRate: z.number().nonnegative(),
    downloadQuota: z.number().nonnegative(),
    uploadQuota: z.number().nonnegative(),
    gateway: z.string().optional(),
});

app.post('/packages', requireAdmin, async (c) => {
    const parsed = createPackageSchema.safeParse(await c.req.json());
    if (!parsed.success) {
        return jsonError(c, 400, 'Invalid package payload');
    }
    // TODO: persist to DB and assign a packageId.
    return c.json({ success: true, data: parsed.data }, 201);
});

// --- Authentication (phone + PIN) -------------------------------------------

// Public: register a new phone-number account. Validation runs here so
// business rules can be enforced beyond what better-auth provides; the
// better-auth account creation itself happens server-side below.
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
                // better-auth requires an email; derive a placeholder from
                // the phone number since this system is phone-only.
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

// Public: log in with phone number + PIN.
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

// Authenticated: current session + client info.
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

// Authenticated: current device quotas. Returns an empty list until the
// quota/device schema is ported to drizzle.
app.get('/status', requireAuth, (c) => {
    const quotas: Array<Quota> = [];
    return c.json({ success: true, data: quotas });
});

// --- Orders / payments ------------------------------------------------------

const orderSchema = z.object({
    packageId: z.string().min(8).max(32),
    phoneNumber: z.string().min(10),
});

// Authenticated: initiate a package purchase. Returns a payment id the client
// can poll. Payment processing (M-Pesa) will be wired in once the payments
// schema is ported.
app.post('/order', requireAuth, async (c) => {
    const parsed = orderSchema.safeParse(await c.req.json());
    if (!parsed.success) {
        return jsonError(c, 400, 'Invalid order payload');
    }

    const pkg = PACKAGES.flatMap(([, pkgs]) => pkgs).find(
        (p) => p.packageId === parsed.data.packageId,
    );

    if (!pkg) return jsonError(c, 404, 'Package not found');

    const paymentId = crypto.randomUUID();
    return c.json({
        success: true,
        data: {
            paymentId,
            status: 'pending',
            amount: pkg.price,
            packageId: pkg.packageId,
        },
    });
});

// Authenticated: deauthenticate a device quota.
app.post('/deauth/:deviceQuotaId', requireAuth, async (c) => {
    const deviceQuotaId = c.req.param('deviceQuotaId');
    if (!deviceQuotaId) return jsonError(c, 400, 'Missing device quota id');
    // TODO: mark the device quota as deauthorized in the DB.
    return c.json({ success: true, data: { deviceQuotaId } });
});

// --- Admin ------------------------------------------------------------------

// Admin: list all users (delegates to the better-auth admin API).
app.get('/users', requireAdmin, async (c) => {
    const data = await auth.api.listUsers({
        query: { limit: 100 },
        headers: c.req.raw.headers,
    });
    return c.json({ success: true, data });
});

// --- Auth helpers -----------------------------------------------------------

// Strip non-digits from a phone number (used to derive the placeholder email
// better-auth requires in this phone-only system).
function normalizePhone(phone: string) {
    return phone.replace(/\D/g, '');
}

// Flatten zod issues into a { field: message } map for the client form.
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

// Copy the better-auth session cookies onto our JSON response so the
// browser stores the newly issued session.
function forwardCookies(c: AppContext, headers: Headers, body: unknown) {
    const res = c.json(body);
    for (const cookie of headers.getSetCookie()) {
        res.headers.append('Set-Cookie', cookie);
    }
    return res;
}

// Map a better-auth APIError onto the {success:false, fieldErrors} envelope
// so the client can render field-specific messages.
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
            return jsonFieldErrors(c, 409, {
                phoneNumber: 'Phone number already registered',
            });
        }
        if (
            message.includes('password') ||
            message.includes('credential') ||
            message.includes('invalid')
        ) {
            return jsonFieldErrors(c, 401, {
                pin: 'Invalid phone number or PIN',
            });
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
