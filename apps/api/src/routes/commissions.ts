import { TABLE_PAGE_SIZES } from '@radii/shared';
import { and, count, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db';
import { commissionAgents, commissionAgreements, commissionJournal, commissionWithdrawalEvents, commissionWithdrawals, nasDevice, pppoeServiceAccounts } from '../db/schema';
import { env } from '../env';
import { addAgreement, agentBalances, CommissionError, ownedAgent, reserveWithdrawal, transitionWithdrawal, updateAgent } from '../lib/commissions';
import { jsonError } from '../lib/error';
import { apiLogger } from '../logging';
import { requireAdmin } from '../middleware/auth';
import type { AppVariables } from '../types';

const app = new Hono<{ Variables: AppVariables }>();
const uuid = z.string().uuid();
const agentFields = z.object({ name: z.string().trim().min(1).max(200), phone: z.string().trim().max(40).nullable().optional(), notes: z.string().trim().max(4000).nullable().optional() }).strict();
const agreementSchema = z.object({ scopeType: z.enum(['nas', 'service_account']), scopeId: uuid,
    rateBps: z.number().int().min(0).max(10000), basis: z.literal('confirmed_collection_gross'), effectiveFrom: z.iso.datetime({ offset: true }).optional() }).strict();
const withdrawalSchema = z.object({ amount: z.string().regex(/^(0|[1-9][0-9]{0,17})(\.[0-9]{1,2})?$/), currency: z.string().regex(/^[A-Z]{3}$/), idempotencyKey: uuid, note: z.string().trim().max(2000).optional() }).strict();
const decisions = {
    approve: z.object({}).strict(),
    reject: z.object({ reason: z.string().trim().min(1).max(2000) }).strict(),
    paid: z.object({ reference: z.string().trim().min(1).max(200), evidence: z.string().trim().min(1).max(4000) }).strict(),
};
const pageSchema = z.object({ page: z.coerce.number().int().min(1).max(1000000).default(1),
    perPage: z.coerce.number().int().refine(v => (TABLE_PAGE_SIZES as readonly number[]).includes(v) && v <= 100).default(25) });

app.use('*', requireAdmin);
app.use('*', async (c, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
        const origin = c.req.header('Origin');
        // No-Origin requests support intentional server/API clients. Browser
        // requests must come from an explicitly trusted admin frontend.
        if (origin !== undefined && !env.adminFrontendUrls.includes(origin)) return jsonError(c, 403, 'Untrusted request origin');
        if (c.req.header('Sec-Fetch-Site') === 'cross-site' && origin === undefined) return jsonError(c, 403, 'Untrusted request origin');
        if (c.req.header('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') return jsonError(c, 400, 'JSON content type required');
    }
    await next();
});
app.onError((error, c) => {
    if (error instanceof CommissionError) return jsonError(c, error.status, error.message);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return jsonError(c, 400, 'Invalid request');
    const cause = error.cause as { errno?: string; code?: string } | undefined;
    if (String(cause?.errno ?? cause?.code) === '23505') return jsonError(c, 409, 'Conflicting accounting request');
    apiLogger.getChild('commissions').error('Commission request failed', { error });
    return jsonError(c, 500, 'Internal server error');
});

async function pageRows(table: PgTable & { id: AnyPgColumn }, where: SQL, order: AnyPgColumn, query: Record<string, string>) {
    const { page, perPage } = pageSchema.parse(query);
    const [total] = await db.select({ value: count() }).from(table).where(where);
    const items = await db.select().from(table).where(where).orderBy(desc(order), desc(table.id)).limit(perPage).offset((page - 1) * perPage);
    return { items, total: total!.value, page, perPage };
}

app.get('/', async c => c.json({ success: true, data: await pageRows(commissionAgents, eq(commissionAgents.tenantAdminId, c.var.adminSession.userId), commissionAgents.createdAt, c.req.query()) }));
app.post('/', async c => {
    const input = agentFields.parse(await c.req.json());
    const [agent] = await db.insert(commissionAgents).values({ ...input, tenantAdminId: c.var.adminSession.userId }).returning();
    return c.json({ success: true, data: agent }, 201);
});

app.get('/scopes', async c => {
    const type = z.enum(['nas', 'service_account']).parse(c.req.query('scopeType') ?? 'nas');
    const { page, perPage } = pageSchema.parse(c.req.query());
    const tenant = c.var.adminSession.userId;
    if (type === 'nas') {
        const where = eq(nasDevice.ownerId, tenant);
        const [total] = await db.select({ value: count() }).from(nasDevice).where(where);
        const items = await db.select({ id: nasDevice.id, label: nasDevice.name, scopeType: sql<'nas'>`'nas'` }).from(nasDevice).where(where).orderBy(nasDevice.name, nasDevice.id).limit(perPage).offset((page - 1) * perPage);
        return c.json({ success: true, data: { items, total: total!.value, page, perPage } });
    }
    const where = eq(pppoeServiceAccounts.tenantAdminId, tenant);
    const [total] = await db.select({ value: count() }).from(pppoeServiceAccounts).where(where);
    const items = await db.select({ id: pppoeServiceAccounts.id, label: sql<string>`coalesce(${pppoeServiceAccounts.label},${pppoeServiceAccounts.username})`, scopeType: sql<'service_account'>`'service_account'` }).from(pppoeServiceAccounts).where(where).orderBy(pppoeServiceAccounts.username, pppoeServiceAccounts.id).limit(perPage).offset((page - 1) * perPage);
    return c.json({ success: true, data: { items, total: total!.value, page, perPage } });
});

app.get('/:agentId', async c => c.json({ success: true, data: await ownedAgent(db, c.var.adminSession.userId, c.req.param('agentId')) }));
app.put('/:agentId', async c => {
    const input = agentFields.partial().extend({ status: z.enum(['active', 'archived']).optional() }).strict().refine(v => Object.keys(v).length > 0).parse(await c.req.json());
    return c.json({ success: true, data: await updateAgent(c.var.adminSession.userId, c.req.param('agentId'), input) });
});
app.get('/:agentId/agreements', async c => {
    const tenant = c.var.adminSession.userId, agentId = c.req.param('agentId');
    await ownedAgent(db, tenant, agentId);
    return c.json({ success: true, data: await pageRows(commissionAgreements, and(eq(commissionAgreements.tenantAdminId, tenant), eq(commissionAgreements.agentId, agentId))!, commissionAgreements.effectiveFrom, c.req.query()) });
});
app.post('/:agentId/agreements', async c => c.json({ success: true, data: await addAgreement(c.var.adminSession.userId, c.req.param('agentId'), agreementSchema.parse(await c.req.json())) }, 201));
app.get('/:agentId/statement', async c => {
    const tenant = c.var.adminSession.userId, agentId = c.req.param('agentId');
    // One repeatable-read snapshot keeps page and balances consistent while
    // reservations/accruals happen concurrently.
    const data = await db.transaction(async tx => {
        await ownedAgent(tx, tenant, agentId);
        const { page, perPage } = pageSchema.parse(c.req.query());
        const where = and(eq(commissionJournal.tenantAdminId, tenant), eq(commissionJournal.agentId, agentId));
        const [total] = await tx.select({ value: count() }).from(commissionJournal).where(where);
        const items = await tx.select().from(commissionJournal).where(where).orderBy(desc(commissionJournal.createdAt), desc(commissionJournal.id)).limit(perPage).offset((page - 1) * perPage);
        return { items, total: total!.value, page, perPage, balances: await agentBalances(tx, tenant, agentId) };
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
    return c.json({ success: true, data });
});
app.get('/:agentId/withdrawals', async c => {
    const tenant = c.var.adminSession.userId, agentId = c.req.param('agentId');
    await ownedAgent(db, tenant, agentId);
    return c.json({ success: true, data: await pageRows(commissionWithdrawals, and(eq(commissionWithdrawals.tenantAdminId, tenant), eq(commissionWithdrawals.agentId, agentId))!, commissionWithdrawals.createdAt, c.req.query()) });
});
app.post('/:agentId/withdrawals', async c => c.json({ success: true, data: await reserveWithdrawal(c.var.adminSession.userId, c.req.param('agentId'), withdrawalSchema.parse(await c.req.json())) }, 201));
app.get('/:agentId/withdrawals/:withdrawalId', async c => {
    const tenant = c.var.adminSession.userId, agentId = c.req.param('agentId');
    await ownedAgent(db, tenant, agentId);
    const [withdrawal] = await db.select().from(commissionWithdrawals).where(and(eq(commissionWithdrawals.id, uuid.parse(c.req.param('withdrawalId'))), eq(commissionWithdrawals.tenantAdminId, tenant), eq(commissionWithdrawals.agentId, agentId)));
    if (!withdrawal) return jsonError(c, 404, 'Withdrawal not found');
    const events = await db.select().from(commissionWithdrawalEvents).where(eq(commissionWithdrawalEvents.withdrawalId, withdrawal.id)).orderBy(commissionWithdrawalEvents.createdAt, commissionWithdrawalEvents.id);
    return c.json({ success: true, data: { withdrawal, events } });
});
for (const action of ['approve', 'reject', 'paid'] as const) {
    app.post(`/:agentId/withdrawals/:withdrawalId/${action}`, async c => c.json({ success: true,
        data: await transitionWithdrawal(c.var.adminSession.userId, c.req.param('agentId'), c.req.param('withdrawalId'), action, decisions[action].parse(await c.req.json())),
    }));
}

export default app;
