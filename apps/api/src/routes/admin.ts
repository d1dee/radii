import {
    adminSettingsSchema,
    createNasDeviceSchema,
    createPackageSchema,
    generateSetupScriptSchema,
    zPhoneNumber,
} from '@radii/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { env } from '../env';
import { getAdminSettings, saveAdminSettings } from '../lib/adminSettings';
import {
    addUserFlag,
    canAdminManageActivation,
    canAdminManageGlobalUser,
    deleteAdminUser,
    getAdminNasAddresses,
    getAdminPaymentDetail,
    getAdminReports,
    getAdminSessionDetail,
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
    upsertUserAdminTag,
} from '../lib/adminUsers';
import { jsonError } from '../lib/error';
import {
    createNasDevice,
    deleteNasDevice,
    getNasDeviceById,
    getNasDevices,
    updateNasDevice,
} from '../lib/nas';
import {
    createPackage,
    deletePackage,
    getNasDeviceAnalytics,
    getNasDeviceIdsByPackage,
    getNasDeviceIdsForPackage,
    getPackageAnalytics,
    getPackageById,
    getPackages,
    updatePackage,
} from '../lib/packages';
import { RadiusError, radiusClient } from '../lib/radius';
import { removePeer, wgManagementEnabled } from '../lib/wireguard';
import { apiLogger } from '../logging';
import {
    getPppoeAccountAdminDetail,
    provisionPppoeAccountByPhone,
    setPppoeAccountLabel,
} from '../lib/pppoeAccounts';
import {
    buildBootstrapScript,
    generateSetupScript,
    getSetupScriptForNasDevice,
    SetupScriptConfigError,
} from '../lib/setupScript';
import { requireAdmin } from '../middleware/auth';
import type { AppVariables } from '../types';

const app = new Hono<{ Variables: AppVariables }>();
const logger = apiLogger.getChild('admin');

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

function isForeignKeyViolation(e: unknown): boolean {
    const err = e as {
        code?: string;
        cause?: { errno?: string | number; code?: string };
    };
    return (
        String(err?.cause?.errno ?? err?.cause?.code ?? err?.code) === '23503'
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
        { ...data, price: String(data.price), createdBy: c.var.admin.id },
        nasDeviceIds,
    );

    return c.json({ success: true, data: { ...row, nasDeviceIds } }, 201);
});

app.get('/packages/:id', requireAdmin, async (c) => {
    const packageId = c.req.param('id');
    if (!packageId) {
        return jsonError(c, 404, 'Package not found');
    }
    const row = await getPackageById(packageId, c.var.adminSession.userId);
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
    const adminId = c.var.adminSession.userId;
    const pkg = await getPackageById(packageId, adminId);
    if (!pkg) {
        return jsonError(c, 404, 'Package not found');
    }
    const data = await getPackageAnalytics(packageId, adminId);
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
        c.var.adminSession.userId,
        { ...data, price: String(data.price) },
        nasDeviceIds,
    );
    if (!row) {
        return jsonError(c, 404, 'Package not found');
    }
    return c.json({ success: true, data: { ...row, nasDeviceIds } });
});

app.delete('/packages/:id', requireAdmin, async (c) => {
    const packageId = c.req.param('id');
    if (!packageId) return jsonError(c, 404, 'Package not found');
    try {
        const result = await deletePackage(
            packageId,
            c.get('adminSession').userId,
        );
        if (result === 'not_found') {
            return jsonError(c, 404, 'Package not found');
        }
        if (result === 'in_use') {
            return jsonError(
                c,
                409,
                'This package has payment or activation history and cannot be deleted',
            );
        }
        return c.json({ success: true, message: 'Package deleted' });
    } catch (e) {
        if (isForeignKeyViolation(e)) {
            return jsonError(
                c,
                409,
                'This package is in use and cannot be deleted',
            );
        }
        throw e;
    }
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
                'NAS device conflicts with an existing device',
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
    const data = await getNasDeviceAnalytics(device.id, [
        ...(await getAdminNasAddresses(
            c.get('adminSession').userId,
            device.id,
        )),
    ]);
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

    return c.json({
        success: true,
        data: {
            ...row,
            script: buildBootstrapScript(
                device.id,
                row.registrationToken,
                env.apiUrl,
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
                'NAS device conflicts with an existing device',
            );
        }
        throw e;
    }
});

app.delete('/nas-devices/:id', requireAdmin, async (c) => {
    const id = c.req.param('id');
    if (!id) return jsonError(c, 404, 'NAS device not found');
    try {
        const result = await deleteNasDevice(
            id,
            c.get('adminSession').userId,
        );
        if (result.status === 'not_found') {
            return jsonError(c, 404, 'NAS device not found');
        }
        if (result.status === 'in_use') {
            const message =
                result.reason === 'pppoe'
                    ? 'Move or remove this NAS device’s PPPoE accounts before deleting it'
                    : result.reason === 'packages'
                      ? 'Remove this NAS device from its packages before deleting it'
                      : 'This NAS device has customer or payment history and cannot be deleted';
            return jsonError(c, 409, message);
        }
        if (result.wgPublicKey && wgManagementEnabled()) {
            try {
                await removePeer(result.wgPublicKey);
            } catch (e) {
                logger.error('Failed to remove deleted NAS WireGuard peer', {
                    nasDeviceId: id,
                    error: e,
                });
            }
        }
        return c.json({ success: true, message: 'NAS device deleted' });
    } catch (e) {
        if (isForeignKeyViolation(e)) {
            return jsonError(
                c,
                409,
                'This NAS device is in use and cannot be deleted',
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
    const pppoeAccounts = await radiusClient.getPppoeCredentialsForUser(
        id,
        c.get('adminSession').userId,
    );

    return c.json({ success: true, data: { ...detail, pppoeAccounts } });
});

// Per-admin CRM tag (friendly name + location) for one customer. Optional
// fields; pass empty/null to clear. Scoped to the requesting admin, so it
// never affects the customer's identity or other tenants' views.
const userTagSchema = z.object({
    name: z.string().trim().max(80).nullish(),
    location: z.string().trim().max(120).nullish(),
});

app.put('/users/:id/tag', requireAdmin, async (c) => {
    const id = c.req.param('id');
    if (!id) return jsonError(c, 404, 'User not found');
    const parsed = userTagSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return jsonError(c, 400, 'Invalid tag payload');
    const tag = await upsertUserAdminTag(c.get('adminSession').userId, id, {
        name: parsed.data.name || null,
        location: parsed.data.location || null,
    });
    if (!tag) return jsonError(c, 404, 'User not found');
    return c.json({ success: true, data: tag });
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
    if (!(await canAdminManageGlobalUser(c.get('adminSession').userId, id))) {
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
    if (!(await canAdminManageGlobalUser(c.get('adminSession').userId, id))) {
        return jsonError(c, 404, 'User not found');
    }
    const row = await setUserBan(id, false);
    if (!row) return jsonError(c, 404, 'User not found');
    return c.json({ success: true, message: 'User unbanned' });
});

app.delete('/users/:id', requireAdmin, async (c) => {
    const id = c.req.param('id');
    if (!id) return jsonError(c, 404, 'User not found');
    if (!(await canAdminManageGlobalUser(c.get('adminSession').userId, id))) {
        return jsonError(c, 404, 'User not found');
    }
    const result = await deleteAdminUser(id);
    if (result === 'not_found') return jsonError(c, 404, 'User not found');
    if (result === 'in_use') {
        return jsonError(
            c,
            409,
            'This user has payment, activation, or PPPoE history and cannot be deleted; ban the account instead',
        );
    }
    return c.json({ success: true, message: 'User deleted' });
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
        const activationIds = await getOwnedActivationIds(adminId, id);
        const addresses = [...(await getAdminNasAddresses(adminId))];
        const all = await radiusClient.getAdminActivations({
            userId: id,
            activationIds,
            nasIpAddresses: addresses,
        });
        return c.json({
            success: true,
            data: all,
        });
    } catch (err) {
        logger.error('RADIUS activation listing failed', { error: err });
        return jsonError(c, 502, 'Could not contact the RADIUS system');
    }
});

// --- PPPoE password management ------------------------------------------------

const provisionPppoeSchema = z.object({
    phoneNumber: zPhoneNumber,
    // The PPPoE instance (NAS device) the account belongs to. Required: the
    // first dial bonds the user to this network and the portal shows this
    // network's packages.
    nasDeviceId: z.uuid(),
    label: z.string().trim().max(80).optional(),
});

app.post('/pppoe-accounts/provision', requireAdmin, async (c) => {
    const parsed = provisionPppoeSchema.safeParse(
        await c.req.json().catch(() => ({})),
    );
    if (!parsed.success) {
        return jsonError(c, 400, 'Enter a valid phone number and NAS device');
    }
    const adminId = c.get('adminSession').userId;
    const device = await getNasDeviceById(parsed.data.nasDeviceId, adminId);
    if (!device) {
        return jsonError(c, 400, 'Select one of your NAS devices');
    }
    try {
        const provisioned = await provisionPppoeAccountByPhone(
            adminId,
            parsed.data.nasDeviceId,
            parsed.data.phoneNumber,
            parsed.data.label,
        );
        return c.json(
            {
                success: true,
                data: {
                    accountId: provisioned.account.id,
                    phoneNumber: provisioned.account.normalizedPhone,
                    label: provisioned.account.label,
                    username: provisioned.account.username,
                    password: provisioned.password,
                    claimCode: provisioned.claimCode,
                    nasDeviceId: provisioned.account.nasDeviceId,
                    nasName: device.name,
                    linked: provisioned.account.customerUserId !== null,
                },
            },
            201,
        );
    } catch (err) {
        logger.error('PPPoE provisioning failed', { error: err });
        return jsonError(c, 409, 'Could not provision PPPoE credentials');
    }
});

// Migrates an account to another NAS device of this admin and cuts its live
// sessions so the customer re-dials through the new router.
const migratePppoeNasSchema = z.object({ nasDeviceId: z.uuid() });

app.put('/pppoe-accounts/:id/nas', requireAdmin, async (c) => {
    const id = c.req.param('id');
    if (!id) return jsonError(c, 404, 'PPPoE account not found');
    const parsed = migratePppoeNasSchema.safeParse(
        await c.req.json().catch(() => ({})),
    );
    if (!parsed.success) {
        return jsonError(c, 400, 'Select a NAS device');
    }
    try {
        const data = await radiusClient.setPppoeAccountNas(
            id,
            parsed.data.nasDeviceId,
            c.get('adminSession').userId,
        );
        return c.json({
            success: true,
            message:
                data.sessionsDisconnected > 0
                    ? `Moved to the new network; ${data.sessionsDisconnected} live session(s) disconnected`
                    : 'Moved to the new network',
            data,
        });
    } catch (err) {
        if (err instanceof RadiusError) {
            return jsonError(c, 409, err.message);
        }
        logger.error('PPPoE NAS migration failed', { error: err });
        return jsonError(c, 502, 'Could not migrate the PPPoE account');
    }
});

// Status toggle: suspended/closed accounts are rejected at RADIUS authorize
// and skipped by portal provisioning, and suspending/closing cuts live
// sessions immediately. Reactivating (status=active) leaves sessions alone.
const pppoeStatusSchema = z.object({
    status: z.enum(['active', 'suspended', 'closed']),
});

app.put('/pppoe-accounts/:id/status', requireAdmin, async (c) => {
    const id = c.req.param('id');
    if (!id) return jsonError(c, 404, 'PPPoE account not found');
    const parsed = pppoeStatusSchema.safeParse(
        await c.req.json().catch(() => ({})),
    );
    if (!parsed.success) return jsonError(c, 400, 'Invalid status');
    try {
        const data = await radiusClient.setPppoeAccountStatus(
            id,
            parsed.data.status,
            c.get('adminSession').userId,
        );
        const label =
            data.status === 'active'
                ? 'Account reactivated'
                : data.status === 'suspended'
                  ? 'Account suspended'
                  : 'Account closed';
        return c.json({
            success: true,
            message:
                data.sessionsDisconnected > 0
                    ? `${label}; ${data.sessionsDisconnected} live session(s) disconnected`
                    : label,
            data,
        });
    } catch (err) {
        if (err instanceof RadiusError) {
            return jsonError(c, 409, err.message);
        }
        logger.error('PPPoE status change failed', { error: err });
        return jsonError(c, 502, 'Could not update the PPPoE account');
    }
});

// Force-cuts an account's live PPP sessions without changing its status or
// credentials; the customer can re-dial straight away.
app.post('/pppoe-accounts/:id/disconnect', requireAdmin, async (c) => {
    const id = c.req.param('id');
    if (!id) return jsonError(c, 404, 'PPPoE account not found');
    try {
        const data = await radiusClient.disconnectPppoeAccount(
            id,
            c.get('adminSession').userId,
        );
        return c.json({
            success: true,
            message:
                data.sessionsDisconnected > 0
                    ? `${data.sessionsDisconnected} live session(s) disconnected`
                    : 'No live sessions to disconnect',
            data,
        });
    } catch (err) {
        logger.error('PPPoE disconnect failed', { error: err });
        return jsonError(c, 502, 'Could not disconnect the PPPoE sessions');
    }
});

// Renames the admin's private label on the account (empty/null clears it).
const pppoeLabelSchema = z.object({
    label: z.string().trim().max(80).nullish(),
});

app.put('/pppoe-accounts/:id/label', requireAdmin, async (c) => {
    const id = c.req.param('id');
    if (!id) return jsonError(c, 404, 'PPPoE account not found');
    const parsed = pppoeLabelSchema.safeParse(
        await c.req.json().catch(() => ({})),
    );
    if (!parsed.success) return jsonError(c, 400, 'Invalid label payload');
    const data = await setPppoeAccountLabel(
        id,
        c.get('adminSession').userId,
        parsed.data.label || null,
    );
    if (!data) return jsonError(c, 404, 'PPPoE account not found');
    return c.json({ success: true, data });
});

// Provisioned-account detail view, scoped to the provisioning admin's tenant.
app.get('/pppoe-accounts/:id', requireAdmin, async (c) => {
    const id = c.req.param('id');
    if (!id) return jsonError(c, 404, 'PPPoE account not found');
    const data = await getPppoeAccountAdminDetail(
        id,
        c.get('adminSession').userId,
    );
    if (!data) return jsonError(c, 404, 'PPPoE account not found');
    return c.json({ success: true, data });
});

// Sets (or rotates, when no password is supplied) the customer's stable PPPoE
// dialer password and disconnects live sessions so it applies on next dial.
const pppoePasswordSchema = z.object({
    password: z.string().min(6).max(64).optional(),
});

app.post('/pppoe-accounts/:id/password', requireAdmin, async (c) => {
    const id = c.req.param('id');
    if (!id) return jsonError(c, 404, 'PPPoE account not found');
    const parsed = pppoePasswordSchema.safeParse(
        await c.req.json().catch(() => ({})),
    );
    if (!parsed.success) {
        return jsonError(c, 400, 'Invalid password payload');
    }
    try {
        const data = await radiusClient.setPppoePassword(
            id,
            parsed.data.password,
            c.get('adminSession').userId,
            [...(await getAdminNasAddresses(c.get('adminSession').userId))],
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
        logger.error('PPPoE password update failed', { error: err });
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
    const pppoeAccountIdParam = c.req.query('pppoeAccountId');
    if (
        pppoeAccountIdParam &&
        !z.uuid().safeParse(pppoeAccountIdParam).success
    ) {
        return jsonError(c, 400, 'Invalid PPPoE account filter');
    }
    const page = Number(c.req.query('page') ?? 1);
    const perPage = Number(c.req.query('perPage') ?? 50);
    const data = await listPayments({
        adminId: c.get('adminSession').userId,
        status: statusParam as 'pending' | 'paid' | 'failed' | undefined,
        pppoeAccountId: pppoeAccountIdParam || undefined,
        q: c.req.query('q')?.trim() || undefined,
        from,
        to,
        page: Number.isFinite(page) ? page : 1,
        perPage: Number.isFinite(perPage) ? perPage : 50,
    });
    return c.json({ success: true, data });
});

app.get('/payments/:id', requireAdmin, async (c) => {
    const paymentId = c.req.param('id');
    if (!paymentId) return jsonError(c, 404, 'Payment not found');
    const data = await getAdminPaymentDetail(
        paymentId,
        c.get('adminSession').userId,
    );
    if (!data) return jsonError(c, 404, 'Payment not found');
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

// Restores a deactivated activation with its existing expiry and balance.
app.post('/activations/:id/activate', requireAdmin, async (c) => {
    const id = c.req.param('id');
    if (!id) return jsonError(c, 404, 'Unknown activation');
    if (!(await canAdminManageActivation(c.get('adminSession').userId, id))) {
        return jsonError(c, 404, 'Unknown activation');
    }
    try {
        const result = await radiusClient.reactivateActivation(id, {
            adminId: c.get('adminSession').userId,
            actorId: c.get('adminSession').userId,
            nasIpAddresses: [
                ...(await getAdminNasAddresses(c.get('adminSession').userId)),
            ],
        });
        if (!result.ok) {
            return jsonError(c, 400, result.message);
        }
        return c.json({
            success: result.ok,
            message: result.message,
            data: result,
        });
    } catch (err) {
        logger.error('RADIUS activation failed', { error: err });
        return jsonError(c, 502, 'Could not contact the RADIUS system');
    }
});

// Edits an activation's calendar expiry and usable online-time balance.
// RADIUS provisioning and live Session-Timeout caps are updated immediately.
const activationEditSchema = z.object({
    expireAt: z.iso.datetime(),
    remainingSeconds: z.number().int().min(0),
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
    if (!(await canAdminManageActivation(c.get('adminSession').userId, id))) {
        return jsonError(c, 404, 'Unknown activation');
    }
    try {
        const result = await radiusClient.setActivationLimits(
            id,
            new Date(parsed.data.expireAt),
            parsed.data.remainingSeconds,
            {
                adminId: c.get('adminSession').userId,
                actorId: c.get('adminSession').userId,
                nasIpAddresses: [
                    ...(await getAdminNasAddresses(
                        c.get('adminSession').userId,
                    )),
                ],
            },
        );
        if (!result.ok) return jsonError(c, 404, result.message);
        return c.json({ success: true, message: result.message, data: result });
    } catch (err) {
        logger.error('RADIUS activation update failed', { error: err });
        return jsonError(c, 502, 'Could not contact the RADIUS system');
    }
});

// --- RADIUS -----------------------------------------------------------------

// Aggregate network usage from RADIUS accounting over a trailing window:
// live sessions/users, current throughput, average speed per session, and
// the heaviest users. ?windowMinutes=<n> (default 60).
app.get('/radius/summary', requireAdmin, async (c) => {
    const raw = Number(c.req.query('windowMinutes') ?? 60);
    const windowMinutes =
        Number.isFinite(raw) && raw > 0 ? Math.min(raw, 1440) : 60;
    const addresses = await getAdminNasAddresses(c.get('adminSession').userId);
    const data = await radiusClient.getNetworkUsage(windowMinutes, [
        ...addresses,
    ]);
    return c.json({ success: true, data });
});

// RADIUS accounting sessions, most recent first, limited to sessions on the
// requesting admin's NAS devices
// (matched on NAS-IP-Address: direct IP or WireGuard tunnel address).
// ?limit=<n> (default 100).
app.get('/radius/sessions', requireAdmin, async (c) => {
    const raw = Number(c.req.query('limit') ?? 100);
    const limit = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 500) : 100;
    const addresses = await getAdminNasAddresses(c.get('adminSession').userId);
    const data = await radiusClient.getAdminSessions([...addresses], limit);
    return c.json({ success: true, data });
});

app.get('/radius/sessions/:radacctId', requireAdmin, async (c) => {
    const radacctId = c.req.param('radacctId');
    if (!radacctId || !/^\d+$/.test(radacctId)) {
        return jsonError(c, 404, 'Unknown session');
    }
    const data = await getAdminSessionDetail(
        c.get('adminSession').userId,
        radacctId,
    );
    if (!data) return jsonError(c, 404, 'Unknown session');
    return c.json({ success: true, data });
});

// Full status of one activation: remaining time/bytes, live sessions, speeds.
app.get('/radius/activations/:id', requireAdmin, async (c) => {
    const id = c.req.param('id');
    if (!id) return jsonError(c, 404, 'Unknown activation');
    if (!(await isAdminActivationVisible(c.get('adminSession').userId, id))) {
        return jsonError(c, 404, 'Unknown activation');
    }
    const data = await radiusClient.getPackageStatus(id, [
        ...(await getAdminNasAddresses(c.get('adminSession').userId)),
    ]);
    if (!data) return jsonError(c, 404, 'Unknown activation');
    return c.json({ success: true, data });
});

// Admin deactivation: removes the RADIUS provisioning and terminates every
// live session of the activation via Disconnect-Requests sent directly to
// the NAS holding each session (keyed on Acct-Session-Id).
app.post('/radius/activations/:id/deactivate', requireAdmin, async (c) => {
    const id = c.req.param('id');
    if (!id) return jsonError(c, 404, 'Unknown activation');
    if (!(await canAdminManageActivation(c.get('adminSession').userId, id))) {
        return jsonError(c, 404, 'Unknown activation');
    }
    try {
        const result = await radiusClient.deactivateActivation(id, {
            actorId: c.get('adminSession').userId,
            adminId: c.get('adminSession').userId,
            nasIpAddresses: [
                ...(await getAdminNasAddresses(c.get('adminSession').userId)),
            ],
        });
        if (!result.ok && result.sessionsFound === 0) {
            return jsonError(c, 404, result.message);
        }
        return c.json({
            success: result.ok,
            message: result.message,
            data: result,
        });
    } catch (err) {
        logger.error('RADIUS deactivation failed', { error: err });
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
        if (
            !(await radiusClient.isCredentialOwnedByAdmin(
                parsed.data.username,
                c.get('adminSession').userId,
            ))
        ) {
            return jsonError(c, 404, 'Unknown RADIUS credential');
        }
        const data = await radiusClient.checkCredentials(
            parsed.data.username,
            parsed.data.password,
        );
        return c.json({ success: true, data });
    } catch (err) {
        logger.error('RADIUS credential check failed', { error: err });
        return jsonError(c, 502, 'Could not contact the RADIUS system');
    }
});

// Disconnects one live session addressed by its radacct id. Restricted to the
// admin that owns the NAS which emitted the accounting row.
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
        const adminId = c.get('adminSession').userId;
        const result = await radiusClient.disconnectSessionByRadacctId(
            radacctId,
            adminId,
            [...(await getAdminNasAddresses(adminId))],
        );
        if (!result.ok) return jsonError(c, 400, result.message);
        return c.json({ success: true, message: result.message, data: result });
    } catch (err) {
        logger.error('RADIUS session disconnect failed', { error: err });
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
            {
                adminId: c.get('adminSession').userId,
                actorId: c.get('adminSession').userId,
                nasIpAddresses: [
                    ...(await getAdminNasAddresses(
                        c.get('adminSession').userId,
                    )),
                ],
            },
        );
        if (!result.ok) return jsonError(c, 400, result.message);
        return c.json({ success: true, message: result.message, data: result });
    } catch (err) {
        logger.error('RADIUS session update failed', { error: err });
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
