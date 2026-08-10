import { createPackageSchema } from '@radii/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { jsonError } from '../lib/error';
import {
    createPackage,
    getPackageAnalytics,
    getPackageById,
    getPackages,
    updatePackage,
} from '../lib/packages';
import { requireAdmin } from '../middleware/auth';
import type { AppVariables } from '../types';

const app = new Hono<{ Variables: AppVariables }>();

const packageTypeSchema = z.enum(['hotspot', 'pppoe']);

app.get('/packages', requireAdmin, async (c) => {
    const typeParam = c.req.query('type');
    if (
        typeParam !== undefined &&
        !packageTypeSchema.safeParse(typeParam).success
    ) {
        return jsonError(c, 400, 'Invalid package type filter');
    }
    const packages = await getPackages(
        typeParam as 'hotspot' | 'pppoe' | undefined,
    );
    return c.json({ success: true, data: packages });
});

app.post('/packages', requireAdmin, async (c) => {
    const parsed = createPackageSchema.safeParse(await c.req.json());
    if (!parsed.success) {
        return jsonError(c, 400, 'Invalid package payload');
    }
    const row = await createPackage({
        ...parsed.data,
        price: String(parsed.data.price),
    });

    return c.json({ success: true, data: row }, 201);
});

app.get('/packages/:id', requireAdmin, async (c) => {
    const row = await getPackageById(c.req.param('id'));
    if (!row) {
        return jsonError(c, 404, 'Package not found');
    }
    return c.json({ success: true, data: row });
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
    const parsed = createPackageSchema.safeParse(await c.req.json());
    if (!parsed.success) {
        return jsonError(c, 400, 'Invalid package payload');
    }
    const row = await updatePackage(c.req.param('id'), {
        ...parsed.data,
        price: String(parsed.data.price),
        nasConfigId: parsed.data.nasConfigId ?? null,
    });
    if (!row) {
        return jsonError(c, 404, 'Package not found');
    }
    return c.json({ success: true, data: row });
});

export default app;
