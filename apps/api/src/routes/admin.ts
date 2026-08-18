import {
    createNasDeviceSchema,
    createPackageSchema,
    generateSetupScriptSchema,
} from '@radii/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { env } from '../env';
import { jsonError } from '../lib/error';
import {
    createNasDevice,
    getNasDeviceById,
    getNasDevices,
    updateNasDevice,
} from '../lib/nas';
import {
    createPackage,
    getNasDeviceIdsByPackage,
    getNasDeviceIdsForPackage,
    getPackageAnalytics,
    getPackageById,
    getPackages,
    updatePackage,
} from '../lib/packages';
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
    if (!(await ownsAllNasDevices(c.var.session.userId, nasDeviceIds))) {
        return jsonError(c, 400, 'Unknown NAS device');
    }
    const row = await createPackage(
        { ...data, price: String(data.price) },
        nasDeviceIds,
    );

    return c.json(
        { success: true, data: { ...row, nasDeviceIds } },
        201,
    );
});

app.get('/packages/:id', requireAdmin, async (c) => {
    const packageId = c.req.param('id');
    const row = await getPackageById(packageId);
    if (!row) {
        return jsonError(c, 404, 'Package not found');
    }
    const nasDeviceIds = await getNasDeviceIdsForPackage(packageId);
    return c.json({ success: true, data: { ...row, nasDeviceIds } });
});

app.get('/packages/:id/analytics', requireAdmin, async (c) => {
    const packageId = c.req.param('id');
    const pkg = await getPackageById(packageId);
    if (!pkg) {
        return jsonError(c, 404, 'Package not found');
    }
    const data = await getPackageAnalytics(packageId);
    return c.json({ success: true, data });
});

app.put('/packages/:id', requireAdmin, async (c) => {
    const packageId = c.req.param('id');
    const parsed = createPackageSchema.safeParse(await c.req.json());
    if (!parsed.success) {
        return jsonError(c, 400, 'Invalid package payload');
    }
    const { nasDeviceIds, ...data } = parsed.data;
    if (!(await ownsAllNasDevices(c.var.session.userId, nasDeviceIds))) {
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
    const rows = await getNasDevices(c.var.session.userId);
    return c.json({ success: true, data: rows });
});

app.post('/nas-devices', requireAdmin, async (c) => {
    const parsed = createNasDeviceSchema.safeParse(await c.req.json());
    if (!parsed.success) {
        return jsonError(c, 400, 'Invalid NAS device payload');
    }
    const { os, ...rest } = parsed.data;
    try {
        const row = await createNasDevice({
            ...rest,
            id: crypto.randomUUID(),
            ownerId: c.get('session').userId,
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
    const row = await getNasDeviceById(id, c.get('session').userId);
    if (!row) {
        return jsonError(c, 404, 'NAS device not found');
    }
    return c.json({ success: true, data: row });
});

// Generate (or regenerate) the device-specific RouterOS setup script and
// store it. Also registers the device as a FreeRADIUS client.
app.post('/nas-devices/:id/setup-script', requireAdmin, async (c) => {
    const id = c.req.param('id');
    if (!id) return jsonError(c, 406, 'missing NAS id');
    const device = await getNasDeviceById(id, c.get('session').userId);
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
    const device = await getNasDeviceById(id, c.get('session').userId);
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

    const existing = await getNasDeviceById(id, c.get('session').userId);
    if (!existing) {
        return jsonError(c, 404, 'NAS device not found');
    }
    const { os, ...rest } = parsed.data;
    try {
        const row = await updateNasDevice(
            existing.id,
            c.get('session').userId,
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

export default app;
