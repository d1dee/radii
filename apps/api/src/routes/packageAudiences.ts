import { createPackageAudienceSchema } from '@radii/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db';
import { customerTags, packageAudiences, packages } from '../db/schema';
import { isAdminUserVisible } from '../lib/adminUsers';
import { jsonError } from '../lib/error';
import { createPackageAudienceContext, evaluatePackageEligibility } from '../lib/packageAudience';
import { getPackageById } from '../lib/packages';
import { requireAdmin } from '../middleware/auth';
import type { AppVariables } from '../types';

const app = new Hono<{ Variables: AppVariables }>();
app.use('*', requireAdmin);

function isDuplicateName(error: unknown): boolean {
    const failure = error as { code?: string; cause?: { code?: string; errno?: string | number } };
    return String(failure?.cause?.errno ?? failure?.cause?.code ?? failure?.code) === '23505';
}

app.get('/package-audiences', async (c) => {
    const audiences = await db.select().from(packageAudiences)
        .where(eq(packageAudiences.ownerId, c.var.adminSession.userId))
        .orderBy(asc(packageAudiences.name), asc(packageAudiences.id));
    return c.json({ success: true, data: { audiences } });
});

app.post('/package-audiences', async (c) => {
    const parsed = createPackageAudienceSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return jsonError(c, 400, 'Invalid audience conditions');
    const [audience] = await db.insert(packageAudiences).values({
        ...parsed.data,
        ownerId: c.var.adminSession.userId,
    }).returning().catch((error: unknown) => {
        if (isDuplicateName(error)) return [];
        throw error;
    });
    if (!audience) return jsonError(c, 409, 'An audience with that name already exists.');
    return c.json({ success: true, data: { audience } }, 201);
});

app.put('/package-audiences/:id', async (c) => {
    const id = z.uuid().safeParse(c.req.param('id'));
    if (!id.success) return jsonError(c, 404, 'Audience not found');
    const parsed = createPackageAudienceSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return jsonError(c, 400, 'Invalid audience conditions');
    const rows = await db.update(packageAudiences).set({
        ...parsed.data,
        updatedAt: new Date(),
    }).where(and(eq(packageAudiences.id, id.data), eq(packageAudiences.ownerId, c.var.adminSession.userId))).returning().catch((error: unknown) => {
        if (isDuplicateName(error)) return null;
        throw error;
    });
    if (rows === null) return jsonError(c, 409, 'An audience with that name already exists.');
    const [audience] = rows;
    if (!audience) return jsonError(c, 404, 'Audience not found');
    return c.json({ success: true, data: { audience } });
});

app.delete('/package-audiences/:id', async (c) => {
    const id = z.uuid().safeParse(c.req.param('id'));
    if (!id.success) return jsonError(c, 404, 'Audience not found');
    const result = await db.transaction(async (tx) => {
        const [audience] = await tx.select({ id: packageAudiences.id }).from(packageAudiences)
            .where(and(eq(packageAudiences.id, id.data), eq(packageAudiences.ownerId, c.var.adminSession.userId)))
            .limit(1).for('update');
        if (!audience) return 'missing';
        const [linked] = await tx.select({ id: packages.id }).from(packages)
            .where(eq(packages.audienceId, id.data)).limit(1);
        if (linked) return 'linked';
        await tx.delete(packageAudiences).where(eq(packageAudiences.id, id.data));
        return 'deleted';
    });
    if (result === 'missing') return jsonError(c, 404, 'Audience not found');
    if (result === 'linked') return jsonError(c, 409, 'Remove this audience from its packages before deleting it.');
    return c.json({ success: true, data: { ok: true } });
});

const previewSchema = z.object({ userId: z.string().trim().min(1).max(256) });
app.post('/packages/:id/eligibility', async (c) => {
    const id = z.uuid().safeParse(c.req.param('id'));
    if (!id.success) return jsonError(c, 404, 'Package not found');
    const parsed = previewSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return jsonError(c, 400, 'A customer is required');
    const providerId = c.var.adminSession.userId;
    if (!(await isAdminUserVisible(providerId, parsed.data.userId))) return jsonError(c, 404, 'Customer not found');
    const pkg = await getPackageById(id.data, providerId);
    if (!pkg) return jsonError(c, 404, 'Package not found');
    const evaluation = await evaluatePackageEligibility(createPackageAudienceContext({
        executor: db, providerId, userId: parsed.data.userId,
    }), pkg);
    return c.json({ success: true, data: evaluation });
});

const tagsSchema = z.object({ tags: z.array(z.string().trim().min(1).max(64)).max(50) });
app.get('/users/:id/audience-tags', async (c) => {
    const userId = c.req.param('id');
    const ownerId = c.var.adminSession.userId;
    if (!(await isAdminUserVisible(ownerId, userId))) return jsonError(c, 404, 'Customer not found');
    const rows = await db.select({ tag: customerTags.tag }).from(customerTags)
        .where(and(eq(customerTags.ownerId, ownerId), eq(customerTags.userId, userId)))
        .orderBy(asc(customerTags.tag));
    return c.json({ success: true, data: { tags: rows.map((row) => row.tag) } });
});

app.put('/users/:id/audience-tags', async (c) => {
    const userId = c.req.param('id');
    const ownerId = c.var.adminSession.userId;
    if (!(await isAdminUserVisible(ownerId, userId))) return jsonError(c, 404, 'Customer not found');
    const parsed = tagsSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return jsonError(c, 400, 'Invalid audience tags');
    const tags = [...new Set(parsed.data.tags)];
    await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`tags:${ownerId}:${userId}`}, 0))`);
        await tx.delete(customerTags).where(and(eq(customerTags.ownerId, ownerId), eq(customerTags.userId, userId)));
        if (tags.length) await tx.insert(customerTags).values(tags.map((tag) => ({ ownerId, userId, tag })));
    });
    return c.json({ success: true, data: { tags } });
});

export default app;
