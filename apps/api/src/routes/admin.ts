import { createPackageSchema } from '@radii/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { jsonError } from '../lib/error';
import { createPackage, getPackages } from '../lib/packages';
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

export default app;
