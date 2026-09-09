import {
    adminSettingsSchema,
    createNasDeviceSchema,
    createPackageSchema,
    generateSetupScriptSchema,
} from '@radii/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { env } from '../env';
import { getAdminSettings, saveAdminSettings } from '../lib/adminSettings';
import {
    addUserFlag,
    getAdminNasAddresses,
    getAdminReports,
    getAdminUserDetail,
    getOwnedActivationIds,
    getUserPayments,
    isAdminActivationVisible,
    isAdminRadacctVisible,
    isAdminUserVisible,
    listAdminUsers,
    listPayments,
    removeUserFlag,
    setUserBan,
} from '../lib/adminUsers';
import { jsonError } from '../lib/error';
import {
    createNasDevice,
    getNasDeviceById,
    getNasDevices,
    updateNasDevice,
} from '../lib/nas';
import {
    createPackage,
    getNasDeviceAnalytics,
    getNasDeviceIdsByPackage,
    getNasDeviceIdsForPackage,
    getPackageAnalytics,
    getPackageById,
    getPackages,
    updatePackage,
} from '../lib/packages';
import { radiusClient } from '../lib/radius';
import {
    buildBootstrapScript,
    generateSetupScript,
    getSetupScriptForNasDevice,
    SetupScriptConfigError,
} from '../lib/setupScript';
import { requireAdmin } from '../middleware/auth';
import type { AppVariables } from '../types';

const app = new Hono<{ Variables: AppVariables }>();

// Postgres unique-violation SQLSTATE, which bun:sql surfaces as `errno` on
// the error cause wrapped by drizzle.
function isUniqueViolation(e: unknown): boolean {
    const err = e as {
        code?: string;
        cause?: { errno?: string | number; code?: string };
    };
    return (
        String(err?.cause?.errno ?? err?.cause?.code ?? err?.code) === '23505'
    );
}

const packageTypeSchema = z.enum(['hotspot', 'pppoe']);

// Packages may only be linked to NAS devices owned by the current admin.
async function ownsAllNasDevices(
    ownerId: string,
    nasDeviceIds: string[],
): Promise<boolean> {
    if (nasDeviceIds.length === 0) return true;
    const devices = await getNasDevices(ownerId);
    const owned = new Set(devices.map((d) => d.id));
    return nasDeviceIds.every((id) => owned.has(id));
}

app.get('/packages', requireAdmin, async (c) => {
    const typeParam = c.req.query('type');
    if (
        typeParam !== undefined &&
        !packageTypeSchema.safeParse(typeParam).success
    ) {
        return jsonError(c, 400, 'Invalid package type filter');
    }
    const rows = await getPackages(
        c.var.adminSession.userId,
        typeParam as 'hotspot' | 'pppoe' | undefined,
    );
    const links = await getNasDeviceIdsByPackage(rows.map((r) => r.id));
    return c.json({
        success: true,
        data: rows.map((row) => ({
            ...row,
            nasDeviceIds: links[row.id] ?? [],
        })),
    });
});

app.post('/packages', requireAdmin, async (c) => {
    const parsed = createPackageSchema.safeParse(await c.req.json());
    if (!parsed.success) {
        return jsonError(c, 400, 'Invalid package payload');
    }
    const { nasDeviceIds, ...data } = parsed.data;
    if (!(await ownsAllNasDevices(c.var.adminSession.userId, nasDeviceIds))) {
        return jsonError(c, 400, 'Unknown NAS device');
    }
    const row = await createPackage(
        { ...data, price: String(data.price) },
        nasDeviceIds,
    );

    return c.json({ success: true, data: { ...row, nasDeviceIds } }, 201);
});

app.get('/packages/:id', requireAdmin, async (c) => {
    const packageId = c.req.param('id');
    if (!packageId) {
        return jsonError(c, 404, 'Package not found');
    }
    const row = await getPackageById(packageId);
    if (!row) {
        return jsonError(c, 404, 'Package not found');
    }
    const nasDeviceIds = await getNasDeviceIdsForPackage(packageId);
    return c.json({ success: true, data: { ...row, nasDeviceIds } });
});

app.get('/packages/:id/analytics', requireAdmin, async (c) => {
    const packageId = c.req.param('id');
    if (!packageId) {
        return jsonError(c, 404, 'Package not found');
    }
    const pkg = await getPackageById(packageId);
    if (!pkg) {
        return jsonError(c, 404, 'Package not found');
    }
    const data = await getPackageAnalytics(packageId);
    return c.json({ success: true, data });
});

app.put('/packages/:id', requireAdmin, async (c) => {
    const packageId = c.req.param('id');
    if (!packageId) {
        return jsonError(c, 404, 'Package not found');
    }
    const parsed = createPackageSchema.safeParse(await c.req.json());
    if (!parsed.success) {
        return jsonError(c, 400, 'Invalid package payload');
    }
    const { nasDeviceIds, ...data } = parsed.data;
    if (!(await ownsAllNasDevices(c.var.adminSession.userId, nasDeviceIds))) {
        return jsonError(c, 400, 'Unknown NAS device');
    }
    const row = await updatePackage(
        packageId,
        { ...data, price: String(data.price) },
        nasDeviceIds,
    );
    if (!row) {
        return jsonError(c, 404, 'Package not found');
    }
    return c.json({ success: true, data: { ...row, nasDeviceIds } });
});

app.get('/nas-devices', requireAdmin, async (c) => {
    const rows = await getNasDevices(c.var.adminSession.userId);
    return c.json({ success: true, data: rows });
});

app.post('/nas-devices', requireAdmin, async (c) => {
    const parsed = createNasDeviceSchema.safeParse(await c.req.json());
    if (!parsed.success) {
        return jsonError(c, 400, 'Invalid NAS device payload');
    }
    // Destructured field-by-field (not a rest spread): the zod output type
    // loses `ipAddress`'s requiredness through rest-spread inference.
    const {
        os,
        name,
        ipAddress,
        macAddress,
        model,
        serialNumber,
        firmwareVersion,
        location,
        status,
    } = parsed.data;
    try {
        const row = await createNasDevice({
            name,
            ipAddress,
            macAddress,
            model,
            serialNumber,
            firmwareVersion,
            location,
            status,
            ownerId: c.get('adminSession').userId,
            // The DB schema has no OS column; keep it in metadata so new
            // platforms can be added without a migration.
            metadata: { os },
        });
        return c.json({ success: true, data: row }, 201);
    } catch (e) {
        if (isUniqueViolation(e)) {
            return jsonError(
                c,
                409,
                'A NAS device with this serial number already exists',
            );
        }
        throw e;
    }
});

app.get('/nas-devices/:id', requireAdmin, async (c) => {
    const id = c.req.param('id');
    if (!id) return jsonError(c, 406, 'missing NAS id');
    const row = await getNasDeviceById(id, c.get('adminSession').userId);
    if (!row) {
        return jsonError(c, 404, 'NAS device not found');
    }
    return c.json({ success: true, data: row });
});

app.get('/nas-devices/:id/analytics', requireAdmin, async (c) => {
    const id = c.req.param('id');
    if (!id) return jsonError(c, 406, 'missing NAS id');
    const device = await getNasDeviceById(id, c.get('adminSession').userId);
    if (!device) {
        return jsonError(c, 404, 'NAS device not found');
    }
    const data = await getNasDeviceAnalytics(device.id, device.ipAddress);
    return c.json({ success: true, data });
});

// Generate (or regenerate) the device-specific RouterOS setup script and
// store it. Also registers the device as a FreeRADIUS client.
app.post('/nas-devices/:id/setup-script', requireAdmin, async (c) => {
    const id = c.req.param('id');
    if (!id) return jsonError(c, 406, 'missing NAS id');
    const device = await getNasDeviceById(id, c.get('adminSession').userId);
    if (!device) {
        return jsonError(c, 404, 'NAS device not found');
    }

    let body: unknown = {};
    try {
        body = await c.req.json();
    } catch {
        body = {};
    }
    const parsed = generateSetupScriptSchema.safeParse(body);
    if (!parsed.success) {
        const first = parsed.error.issues[0];
        return jsonError(
            c,
            400,
            first ? first.message : 'Invalid script options',
        );
    }

    try {
        const row = await generateSetupScript(device, parsed.data);
        return c.json({ success: true, data: row }, 201);
    } catch (e) {
        if (e instanceof SetupScriptConfigError) {
            return jsonError(c, 400, e.message);
        }
        throw e;
    }
});

// Fetch the stored generated script for this device.
app.get('/nas-devices/:id/setup-script', requireAdmin, async (c) => {
    const id = c.req.param('id');
    if (!id) return jsonError(c, 406, 'missing NAS id');
    const device = await getNasDeviceById(id, c.get('adminSession').userId);
    if (!device) {
        return jsonError(c, 404, 'NAS device not found');
    }
    const row = await getSetupScriptForNasDevice(device.id);
    if (!row) {
        return jsonError(c, 404, 'No setup script generated yet');
    }
    const apiBase = env.baseUrl.replace(/\/+$/, '');
    return c.json({
        success: true,
        data: {
            ...row,
            script: buildBootstrapScript(
                device.id,
                row.registrationToken,
                apiBase,
            ),
        },
    });
});

app.put('/nas-devices/:id', requireAdmin, async (c) => {
    const id = c.req.param('id');
    if (!id) return jsonError(c, 404, 'Invalid NAS id');

    const parsed = createNasDeviceSchema.safeParse(await c.req.json());
    if (!parsed.success) {
        return jsonError(c, 400, 'Invalid NAS device payload');
    }

    const existing = await getNasDeviceById(id, c.get('adminSession').userId);
    if (!existing) {
        return jsonError(c, 404, 'NAS device not found');
    }
    const { os, ...rest } = parsed.data;
    try {
        const row = await updateNasDevice(
            existing.id,
            c.get('adminSession').userId,
            {
                ...rest,
                metadata: {
                    ...((existing.metadata ?? {}) as Record<string, unknown>),
                    os,
                },
            },
        );
        return c.json({ success: true, data: row });
    } catch (e) {
        if (isUniqueViolation(e)) {
            return jsonError(
                c,
                409,
                'A NAS device with this serial number already exists',
            );
        }
        throw e;
    }
});

// --- Users (hotspot + PPPoE customer management) -----------------------------

const userTypeFilterSchema = z.enum(['hotspot', 'pppoe']);

// Customer list with lifetime value aggregates; supports search, service-type
// and flagged filters, paginated.
app.get('/users', requireAdmin, async (c) => {
    const q = c.req.query('q')?.trim() || undefined;
    const flagged = c.req.query('flagged') === '1';
    const typeParam = c.req.query('type');
    const type = typeParam
        ? userTypeFilterSchema.safeParse(typeParam).success
            ? (typeParam as 'hotspot' | 'pppoe')
            : undefined
        : undefined;
    if (typeParam && !type) {
        return jsonError(c, 400, 'Invalid user type filter');
    }
    const page = Number(c.req.query('page') ?? 1);
    const perPage = Number(c.req.query('perPage') ?? 50);
    const data = await listAdminUsers({
        adminId: c.get('adminSession').userId,
        q,
        type,
        flagged,
        page: Number.isFinite(page) ? page : 1,
        perPage: Number.isFinite(perPage) ? perPage : 50,
    });
    return c.json({ success: true, data });
});

// One customer's valuation: identity, moderation state, lifetime payments,
// activations, usage, flags and PPPoE credentials.
app.get('/users/:id', requireAdmin, async (c) => {
    const id = c.req.param('id');
    if (!id) return jsonError(c, 404, 'User not found');
    const detail = await getAdminUserDetail(id, c.get('adminSession').userId);
    if (!detail) return jsonError(c, 404, 'User not found');

    // Only surface dialer credentials once the customer actually has a PPPoE
    // history (the username derivation is deterministic for every user).
    let pppoe: { username: string; password: string | null } | null = null;
    if (detail.activations.pppoe > 0) {
        const credentials = await radiusClient.getPppoeCredentials(id);
        pppoe = credentials.password ? credentials : null;
    }

    return c.json({ success: true, data: { ...detail, pppoe } });
});

const flagSchema = z.object({
    reason: z.string().min(1).max(100),
    note: z.string().max(2000).optional(),
});

app.post('/users/:id/flags', requireAdmin, async (c) => {
    const id = c.req.param('id');
    if (!id) return jsonError(c, 404, 'User not found');
    const parsed = flagSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
        return jsonError(c, 400, 'Invalid flag payload');
    }
    const existing = await getAdminUserDetail(id, c.get('adminSession').userId);
    if (!existing) return jsonError(c, 404, 'User not found');
    const flag = await addUserFlag(
        id,
        c.get('adminSession').userId,
        parsed.data.reason,
        parsed.data.note,
    );
    return c.json({ success: true, data: flag }, 201);
});

app.delete('/users/:id/flags/:flagId', requireAdmin, async (c) => {
    const flagId = c.req.param('flagId');
    if (!flagId) return jsonError(c, 404, 'Flag not found');
    const removed = await removeUserFlag(flagId, c.get('adminSession').userId);
    if (!removed) return jsonError(c, 404, 'Flag not found');
    return c.json({ success: true });
});

const banSchema = z.object({
    reason: z.string().max(500).optional(),
    expiresAt: z.iso.datetime().nullable().optional(),
});

app.post('/users/:id/ban', requireAdmin, async (c) => {
    const id = c.req.param('id');
    if (!id) return jsonError(c, 404, 'User not found');
    const parsed = banSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
        return jsonError(c, 400, 'Invalid ban payload');
    }
    // Only customers on this admin's network can be moderated. The ban
    // itself is account-global (the phone account is shared across portals)
    // and better-auth enforces it at session resolution.
    if (!(await isAdminUserVisible(c.get('adminSession').userId, id))) {
        return jsonError(c, 404, 'User not found');
    }
    const row = await setUserBan(
        id,
        true,
        parsed.data.reason,
        parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
    );
    if (!row) return jsonError(c, 404, 'User not found');
    return c.json({ success: true, message: 'User banned' });
});

app.delete('/users/:id/ban', requireAdmin, async (c) => {
    const id = c.req.param('id');
    if (!id) return jsonError(c, 404, 'User not found');
    if (!(await isAdminUserVisible(c.get('adminSession').userId, id))) {
        return jsonError(c, 404, 'User not found');
    }
    const row = await setUserBan(id, false);
    if (!row) return jsonError(c, 404, 'User not found');
    return c.json({ success: true, message: 'User unbanned' });
});

// Per-user payment log.
app.get('/users/:id/payments', requireAdmin, async (c) => {
    const id = c.req.param('id');
    if (!id) return jsonError(c, 404, 'User not found');
    const data = await getUserPayments(id, c.get('adminSession').userId);
    return c.json({ success: true, data });
});

// Per-user activations (both services, including expired ones) with live
// RADIUS usage, limited to activations on this admin's network.
app.get('/users/:id/activations', requireAdmin, async (c) => {
    const id = c.req.param('id');
    if (!id) return jsonError(c, 404, 'User not found');
    const adminId = c.get('adminSession').userId;
    if (!(await isAdminUserVisible(adminId, id))) {
        return jsonError(c, 404, 'User not found');
    }
    try {
        const all = await radiusClient.getAdminActivations({ userId: id });
        // The phone account is global; filter to activations this admin's
        // NAS devices issued (activation -> payment -> NAS -> owner).
        const owned = new Set(await getOwnedActivationIds(adminId, id));
        return c.json({
            success: true,
            data: all.filter((a) => owned.has(a.activationId)),
        });
    } catch (err) {
        console.error('[radius] admin activation listing failed:', err);
        return jsonError(c, 502, 'Could not contact the RADIUS system');
    }
});

// --- PPPoE password management ------------------------------------------------

// Sets (or rotates, when no password is supplied) the customer's stable PPPoE
// dialer password and disconnects live sessions so it applies on next dial.
const pppoePasswordSchema = z.object({
    password: z.string().min(6).max(64).optional(),
});

app.post('/users/:id/pppoe-password', requireAdmin, async (c) => {
    const id = c.req.param('id');
    if (!id) return jsonError(c, 404, 'User not found');
    const parsed = pppoePasswordSchema.safeParse(
        await c.req.json().catch(() => ({})),
    );
    if (!parsed.success) {
        return jsonError(c, 400, 'Invalid password payload');
    }
    // Restricted to customers on this admin's network. Note the dialer
    // account itself is global per phone (one stable RADIUS account), so a
    // rotation also applies wherever else that customer dials.
    if (!(await isAdminUserVisible(c.get('adminSession').userId, id))) {
        return jsonError(c, 404, 'User not found');
    }
    try {
        const data = await radiusClient.setPppoePassword(
            id,
            parsed.data.password,
        );
        return c.json({
            success: true,
            message:
                data.sessionsDisconnected > 0
                    ? `Password updated; ${data.sessionsDisconnected} live session(s) disconnected`
                    : 'Password updated',
            data,
        });
    } catch (err) {
        console.error('[radius] admin pppoe password set failed:', err);
        return jsonError(c, 502, 'Could not contact the RADIUS system');
    }
});

// --- Payment log ---------------------------------------------------------------

const paymentStatusSchema = z.enum(['pending', 'paid', 'failed']);

app.get('/payments', requireAdmin, async (c) => {
    const statusParam = c.req.query('status');
    if (statusParam && !paymentStatusSchema.safeParse(statusParam).success) {
        return jsonError(c, 400, 'Invalid payment status filter');
    }
    const fromParam = c.req.query('from');
    const toParam = c.req.query('to');
    const from = fromParam ? new Date(fromParam) : undefined;
    const to = toParam ? new Date(toParam) : undefined;
    if (
        (fromParam && Number.isNaN(from?.getTime())) ||
        (toParam && Number.isNaN(to?.getTime()))
    ) {
        return jsonError(c, 400, 'Invalid date range');
    }
    const page = Number(c.req.query('page') ?? 1);
    const perPage = Number(c.req.query('perPage') ?? 50);
    const data = await listPayments({
        adminId: c.get('adminSession').userId,
        status: statusParam as 'pending' | 'paid' | 'failed' | undefined,
        q: c.req.query('q')?.trim() || undefined,
        from,
        to,
        page: Number.isFinite(page) ? page : 1,
        perPage: Number.isFinite(perPage) ? perPage : 50,
    });
    return c.json({ success: true, data });
});

// --- Reports ---------------------------------------------------------------------

// Aggregate reporting for a date range (defaults to the trailing 30 days):
// revenue trend, totals, top packages/users, heaviest consumers.
app.get('/reports', requireAdmin, async (c) => {
    const toParam = c.req.query('to');
    const fromParam = c.req.query('from');
    const to = toParam ? new Date(toParam) : new Date();
    const from = fromParam
        ? new Date(fromParam)
        : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        return jsonError(c, 400, 'Invalid date range');
    }
    if (from.getTime() > to.getTime()) {
        return jsonError(c, 400, 'Invalid date range');
    }
    const data = await getAdminReports(c.get('adminSession').userId, from, to);
    return c.json({ success: true, data });
});

// --- Activation management --------------------------------------------------------

// Re-activates a deactivated/expired activation: the expiry restarts from now
// and the RADIUS provisioning is rebuilt (PPPoE re-authorizes the customer's
// stable dialer account).
app.post('/activations/:id/activate', requireAdmin, async (c) => {
    const id = c.req.param('id');
    if (!id) return jsonError(c, 404, 'Unknown activation');
    if (!(await isAdminActivationVisible(c.get('adminSession').userId, id))) {
        return jsonError(c, 404, 'Unknown activation');
    }
    try {
        const result = await radiusClient.reactivateActivation(id);
        if (!result.ok && !result.expireAt) {
            return jsonError(c, 400, result.message);
        }
        return c.json({
            success: result.ok,
            message: result.message,
            data: result,
        });
    } catch (err) {
        console.error('[radius] admin activation failed:', err);
        return jsonError(c, 502, 'Could not contact the RADIUS system');
    }
});

// Edits an activation's expiry (extend/cut). RADIUS provisioning is kept in
// step (Expiration check-attribute, Session-Timeout caps, CoA on live
// sessions).
const activationEditSchema = z.object({
    expireAt: z.iso.datetime(),
});

app.put('/activations/:id', requireAdmin, async (c) => {
    const id = c.req.param('id');
    if (!id) return jsonError(c, 404, 'Unknown activation');
    const parsed = activationEditSchema.safeParse(
        await c.req.json().catch(() => ({})),
    );
    if (!parsed.success) {
        return jsonError(c, 400, 'Invalid activation payload');
    }
    if (!(await isAdminActivationVisible(c.get('adminSession').userId, id))) {
        return jsonError(c, 404, 'Unknown activation');
    }
    try {
        const result = await radiusClient.setActivationExpiry(
            id,
            new Date(parsed.data.expireAt),
        );
        if (!result.ok) return jsonError(c, 404, result.message);
        return c.json({ success: true, message: result.message, data: result });
    } catch (err) {
        console.error('[radius] admin activation edit failed:', err);
        return jsonError(c, 502, 'Could not contact the RADIUS system');
    }
});

// --- RADIUS -----------------------------------------------------------------

// Aggregate network usage from RADIUS accounting over a trailing window:
// live sessions/users, current throughput, average speed per session, and
// the heaviest users. ?windowMinutes=<n> (default 60).
// NOTE: whole-network aggregate — not yet tenant-scoped (the aggregation
// happens inside the RADIUS client over all accounting rows).
app.get('/radius/summary', requireAdmin, async (c) => {
    const raw = Number(c.req.query('windowMinutes') ?? 60);
    const windowMinutes =
        Number.isFinite(raw) && raw > 0 ? Math.min(raw, 1440) : 60;
    const data = await radiusClient.getNetworkUsage(windowMinutes);
    return c.json({ success: true, data });
});

// Live RADIUS sessions (radacct rows without a stop record), most recent
// first, limited to sessions on the requesting admin's NAS devices
// (matched on NAS-IP-Address: direct IP or WireGuard tunnel address).
// ?limit=<n> (default 100).
app.get('/radius/sessions', requireAdmin, async (c) => {
    const raw = Number(c.req.query('limit') ?? 100);
    const limit = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 500) : 100;
    const data = await radiusClient.getLiveSessions(limit);
    const addresses = await getAdminNasAddresses(c.get('adminSession').userId);
    return c.json({
        success: true,
        data: data.filter((s) =>
            addresses.has(String(s.nasIpAddress).replace(/\/\d+$/, '')),
        ),
    });
});

// Full status of one activation: remaining time/bytes, live sessions, speeds.
app.get('/radius/activations/:id', requireAdmin, async (c) => {
    const id = c.req.param('id');
    if (!id) return jsonError(c, 404, 'Unknown activation');
    if (!(await isAdminActivationVisible(c.get('adminSession').userId, id))) {
        return jsonError(c, 404, 'Unknown activation');
    }
    const data = await radiusClient.getPackageStatus(id);
    if (!data) return jsonError(c, 404, 'Unknown activation');
    return c.json({ success: true, data });
});

// Admin deactivation: removes the RADIUS provisioning and terminates every
// live session of the activation via Disconnect-Requests sent directly to
// the NAS holding each session (keyed on Acct-Session-Id).
app.post('/radius/activations/:id/deactivate', requireAdmin, async (c) => {
    const id = c.req.param('id');
    if (!id) return jsonError(c, 404, 'Unknown activation');
    if (!(await isAdminActivationVisible(c.get('adminSession').userId, id))) {
        return jsonError(c, 404, 'Unknown activation');
    }
    try {
        const result = await radiusClient.deactivateActivation(id);
        if (!result.ok && result.sessionsFound === 0) {
            return jsonError(c, 404, result.message);
        }
        return c.json({
            success: result.ok,
            message: result.message,
            data: result,
        });
    } catch (err) {
        console.error('[radius] admin deactivation failed:', err);
        return jsonError(c, 502, 'Could not contact the RADIUS system');
    }
});

// Validates a RADIUS user against the RADIUS server with a real
// Access-Request (provisioning diagnostics; requires RADIUS_SERVER/RADIUS_SECRET).
app.post('/radius/check-credentials', requireAdmin, async (c) => {
    const parsed = z
        .object({ username: z.string().min(1), password: z.string().min(1) })
        .safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
        return jsonError(c, 400, 'Invalid payload');
    }
    try {
        const data = await radiusClient.checkCredentials(
            parsed.data.username,
            parsed.data.password,
        );
        return c.json({ success: true, data });
    } catch (err) {
        return jsonError(
            c,
            502,
            err instanceof Error ? err.message : 'RADIUS check failed',
        );
    }
});

// Disconnects one live session addressed by its radacct id. Restricted to
// sessions whose activation belongs to the requesting admin's network
// (RADIUS Class correlation).
app.post('/radius/sessions/:radacctId/disconnect', requireAdmin, async (c) => {
    const radacctId = c.req.param('radacctId');
    if (!radacctId || !/^\d+$/.test(radacctId)) {
        return jsonError(c, 404, 'Unknown session');
    }
    if (
        !(await isAdminRadacctVisible(c.get('adminSession').userId, radacctId))
    ) {
        return jsonError(c, 404, 'Unknown session');
    }
    try {
        const result =
            await radiusClient.disconnectSessionByRadacctId(radacctId);
        if (!result.ok) return jsonError(c, 400, result.message);
        return c.json({ success: true, message: result.message, data: result });
    } catch (err) {
        console.error('[radius] admin session disconnect failed:', err);
        return jsonError(c, 502, 'Could not contact the RADIUS system');
    }
});

// Live-edits a session's remaining time (CoA Session-Timeout to the NAS)
// Restricted to sessions on the requesting admin's network.
const sessionEditSchema = z.object({
    sessionTimeout: z
        .number()
        .int()
        .min(1)
        .max(365 * 24 * 60 * 60),
});

app.put('/radius/sessions/:radacctId', requireAdmin, async (c) => {
    const radacctId = c.req.param('radacctId');
    if (!radacctId || !/^\d+$/.test(radacctId)) {
        return jsonError(c, 404, 'Unknown session');
    }
    const parsed = sessionEditSchema.safeParse(
        await c.req.json().catch(() => ({})),
    );
    if (!parsed.success) {
        return jsonError(c, 400, 'Invalid session payload');
    }
    if (
        !(await isAdminRadacctVisible(c.get('adminSession').userId, radacctId))
    ) {
        return jsonError(c, 404, 'Unknown session');
    }
    try {
        const result = await radiusClient.setSessionTimeoutByRadacctId(
            radacctId,
            parsed.data.sessionTimeout,
        );
        if (!result.ok) return jsonError(c, 400, result.message);
        return c.json({ success: true, message: result.message, data: result });
    } catch (err) {
        console.error('[radius] admin session edit failed:', err);
        return jsonError(c, 502, 'Could not contact the RADIUS system');
    }
});

// --- Per-admin console settings -------------------------------------------------
// Only ever affects the signed-in admin: display formatting, dashboard
// defaults, and their own M-Pesa credentials (server-wide env config remains
// the fallback when they have not configured any). See lib/adminSettings.ts.

app.get('/settings', requireAdmin, async (c) => {
    const settings = await getAdminSettings(c.get('adminSession').userId);
    return c.json({ success: true, data: settings });
});

app.put('/settings', requireAdmin, async (c) => {
    const parsed = adminSettingsSchema.safeParse(
        await c.req.json().catch(() => ({})),
    );
    if (!parsed.success) {
        return jsonError(
            c,
            400,
            parsed.error.issues[0]?.message ?? 'Invalid settings',
        );
    }
    const settings = await saveAdminSettings(
        c.get('adminSession').userId,
        parsed.data,
    );
    return c.json({ success: true, data: settings });
});

export default app;
