import { and, count, desc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { agentAuth } from '../agentAuth';
import { db } from '../db';
import { adminUser, agentMemberships, agentPayoutProfiles, agentPortalAudit, commissionAgents, commissionAgreements, commissionJournal, commissionWithdrawalEvents, commissionWithdrawals } from '../db/schema';
import { env } from '../env';
import { auditPortal, authorizeAgentWithdrawal, latestPayout, lockPortalAgent, portalMembership } from '../lib/agentPortal';
import { agentBalances, CommissionError, reserveWithdrawal, resolveWithdrawalIntent, withdrawalIntent, type CommissionTx } from '../lib/commissions';
import { jsonError } from '../lib/error';
import { apiLogger } from '../logging';
import type { AppVariables } from '../types';

type AgentSession = NonNullable<Awaited<ReturnType<typeof agentAuth.api.getSession>>>;
const app = new Hono<{ Variables: AppVariables }>();
const pagination = z.object({ page: z.coerce.number().int().min(1).max(1000000).default(1), perPage: z.coerce.number().int().min(1).max(100).default(25) });
const password = z.string().min(1).max(128);
const withdrawalInput = z.object({ intentId: z.uuid(), password }).strict();
const intentInput = z.object({ amount: z.string().regex(/^(0|[1-9][0-9]{0,17})(\.[0-9]{1,2})?$/), currency: z.string().regex(/^[A-Z]{3}$/),
    previousIntentId: z.uuid().nullable(), note: z.string().trim().max(2000).optional() }).strict();
const payoutInput = z.object({ method: z.enum(['mpesa', 'bank']), accountName: z.string().trim().min(1).max(200), destination: z.string().trim().min(3).max(300), password }).strict();

// Supplement IP limits with an account-scoped step-up budget. Server-side
// BetterAuth calls do not run its HTTP rate limiter. Bounded, single-process.
const attempts = new Map<string, { count: number; until: number }>();
async function stepUp(identity: AgentSession, headers: Headers, value: string) {
    const now = Date.now();
    let bucket = attempts.get(identity.user.id);
    if (!bucket || bucket.until < now) {
        if (attempts.size >= 20000) attempts.delete(attempts.keys().next().value!);
        bucket = { count: 0, until: now + 60000 }; attempts.set(identity.user.id, bucket);
    }
    if (++bucket.count > 5) throw new PortalError(429, 'Too many password confirmations; retry in a minute');
    try { await agentAuth.api.verifyPassword({ headers, body: { password: value } }); }
    catch { throw new PortalError(403, 'Password confirmation failed; sign in again if your session has expired'); }
}
class PortalError extends Error { constructor(public status: 401 | 403 | 429, message: string) { super(message); } }

app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
        const origin = c.req.header('Origin');
        if ((origin !== undefined && !env.agentFrontendUrls.includes(origin)) || (!origin && c.req.header('Sec-Fetch-Site') === 'cross-site')) return jsonError(c, 403, 'Untrusted request origin');
        if (c.req.header('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') return jsonError(c, 400, 'JSON content type required');
    }
    const session = await agentAuth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return jsonError(c, 401, 'Sign in to your agent portal account');
    if (!session.user.emailVerified) return jsonError(c, 403, 'Verify your agent email before continuing');
    c.set('agentIdentity', session);
    await next();
});
app.onError((error, c) => {
    if (error instanceof CommissionError || error instanceof PortalError) return jsonError(c, error.status, error.message);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return jsonError(c, 400, 'Invalid request');
    apiLogger.getChild('agent-portal').error('Agent portal request failed', { error });
    return jsonError(c, 500, 'Internal server error');
});

function publicProfile(p: typeof agentPayoutProfiles.$inferSelect | null) {
    return p ? { id: p.id, method: p.method, accountName: p.accountName, destination: p.destination, verifiedAt: p.verifiedAt, createdAt: p.createdAt } : null;
}
function publicWithdrawal(w: typeof commissionWithdrawals.$inferSelect) {
    const payout = w.payoutSnapshot;
    return { id: w.id, amount: w.amount, currency: w.currency, idempotencyKey: w.idempotencyKey, note: w.note, status: w.status,
        reference: w.reference, createdAt: w.createdAt, updatedAt: w.updatedAt,
        payout: payout ? { method: payout.method, accountName: payout.accountName, destination: payout.destination } : null };
}
async function membershipFor(userId: string, agentId: string) { return portalMembership(db, userId, z.uuid().parse(agentId)); }
function withdrawalActor(userId: string, agentId: string) {
    return { userId, authorize: (tx: CommissionTx) => portalMembership(tx, userId, agentId, true),
        payout: (tx: CommissionTx) => authorizeAgentWithdrawal(tx, userId, agentId) };
}

app.get('/memberships', async c => {
    const items = await db.select({ agentId: commissionAgents.id, name: commissionAgents.name, tenantName: adminUser.name }).from(agentMemberships)
        .innerJoin(commissionAgents, and(eq(commissionAgents.id, agentMemberships.agentId), eq(commissionAgents.tenantAdminId, agentMemberships.tenantAdminId)))
        .innerJoin(adminUser, eq(adminUser.id, agentMemberships.tenantAdminId))
        .where(and(eq(agentMemberships.userId, c.var.agentIdentity.user.id), eq(agentMemberships.status, 'active'), eq(commissionAgents.status, 'active'))).orderBy(commissionAgents.name, commissionAgents.id);
    return c.json({ success: true, data: { items } });
});
app.get('/:agentId/statement', async c => {
    const data = await db.transaction(async tx => {
        const m = await portalMembership(tx, c.var.agentIdentity.user.id, z.uuid().parse(c.req.param('agentId')));
        const { page, perPage } = pagination.parse(c.req.query());
        const where = and(eq(commissionJournal.tenantAdminId, m.tenantAdminId), eq(commissionJournal.agentId, m.agentId));
        const [total] = await tx.select({ value: count() }).from(commissionJournal).where(where);
        const rows = await tx.select().from(commissionJournal).where(where).orderBy(desc(commissionJournal.createdAt), desc(commissionJournal.id)).limit(perPage).offset((page - 1) * perPage);
        // Explicit whitelist: never return customer IDs, transaction IDs,
        // service credentials, accounting account names or raw source metadata.
        const items = rows.map(r => ({ id: r.id, kind: r.kind, amount: r.amount, currency: r.currency, withdrawalId: r.withdrawalId, createdAt: r.createdAt,
            source: r.kind === 'accrual' ? { rateBps: r.snapshot.rateBps, basis: r.snapshot.basis, scopeType: r.snapshot.scopeType,
                collectionAmount: r.snapshot.collectionAmount, collectionRecordedAt: r.snapshot.collectionRecordedAt,
                agreementEffectiveFrom: typeof r.snapshot.effectiveFrom === 'string' ? r.snapshot.effectiveFrom : null,
                rounding: typeof r.snapshot.rounding === 'string' ? r.snapshot.rounding : null,
                entitlementRule: typeof r.snapshot.entitlementTime === 'string' ? r.snapshot.entitlementTime : null } : null }));
        return { items, total: total!.value, page, perPage, balances: await agentBalances(tx, m.tenantAdminId, m.agentId) };
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
    return c.json({ success: true, data });
});
app.get('/:agentId/earnings', async c => {
    const data = await db.transaction(async tx => {
        const m = await portalMembership(tx, c.var.agentIdentity.user.id, z.uuid().parse(c.req.param('agentId')));
        const { page, perPage } = pagination.parse(c.req.query());
        // Aggregate the complete accrual ledger, not a page of statement rows.
        // Explicit UTC conversion makes month boundaries independent of DB timezone.
        const month = sql<string>`to_char(${commissionJournal.createdAt} at time zone 'UTC', 'YYYY-MM')`;
        const scopeType = sql<string | null>`${commissionJournal.snapshot}->>'scopeType'`;
        const rateBps = sql<number | null>`(${commissionJournal.snapshot}->>'rateBps')::integer`;
        const groups = tx.select({ month: month.as('month'), scopeType: scopeType.as('scope_type'), rateBps: rateBps.as('rate_bps'), currency: commissionJournal.currency,
            collections: count().as('collections'),
            collectionAmount: sql<string>`coalesce(sum((${commissionJournal.snapshot}->>'collectionAmount')::numeric), 0.00)::text`.as('collection_amount'),
            earned: sql<string>`sum(${commissionJournal.amount})::text`.as('earned'),
            firstEarnedAt: sql<string>`to_char(min(${commissionJournal.createdAt}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`.as('first_earned_at'),
            lastEarnedAt: sql<string>`to_char(max(${commissionJournal.createdAt}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`.as('last_earned_at'),
        }).from(commissionJournal).where(and(eq(commissionJournal.tenantAdminId, m.tenantAdminId), eq(commissionJournal.agentId, m.agentId), eq(commissionJournal.kind, 'accrual')))
            .groupBy(month, scopeType, rateBps, commissionJournal.currency).as('earnings');
        const [total] = await tx.select({ value: count() }).from(groups);
        const rows = await tx.select().from(groups).orderBy(desc(groups.month), groups.currency, groups.scopeType, groups.rateBps).limit(perPage).offset((page - 1) * perPage);
        const items = rows.map(r => ({ id: JSON.stringify([r.month, r.currency, r.scopeType, r.rateBps]), ...r }));
        return { items, total: total!.value, page, perPage };
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
    return c.json({ success: true, data });
});
app.get('/:agentId/notifications', async c => {
    const data = await db.transaction(async tx => {
        const m = await portalMembership(tx, c.var.agentIdentity.user.id, z.uuid().parse(c.req.param('agentId')));
        const { page, perPage } = pagination.parse(c.req.query());
        const feed = tx.select({ id: sql<string>`'portal:' || ${agentPortalAudit.id}::text`.as('id'), createdAt: agentPortalAudit.createdAt,
            code: agentPortalAudit.action, withdrawalId: sql<string | null>`null::text`.as('withdrawal_id'),
        }).from(agentPortalAudit).where(eq(agentPortalAudit.membershipId, m.id)).unionAll(
            tx.select({ id: sql<string>`'withdrawal:' || ${commissionWithdrawalEvents.id}::text`, createdAt: commissionWithdrawalEvents.createdAt,
                code: sql<string>`'withdrawal_' || ${commissionWithdrawalEvents.status}`, withdrawalId: sql<string | null>`${commissionWithdrawals.id}::text`,
            }).from(commissionWithdrawalEvents).innerJoin(commissionWithdrawals, eq(commissionWithdrawals.id, commissionWithdrawalEvents.withdrawalId))
                .where(and(eq(commissionWithdrawals.tenantAdminId, m.tenantAdminId), eq(commissionWithdrawals.agentId, m.agentId))),
        ).as('notifications');
        const [total] = await tx.select({ value: count() }).from(feed);
        const rows = await tx.select().from(feed).orderBy(desc(feed.createdAt), desc(feed.id)).limit(perPage).offset((page - 1) * perPage);
        // Only fixed, human-facing text. Never interpolate audit details, actor
        // identities, withdrawal reasons, references or internal evidence.
        const messages: Record<string, [string, string]> = {
            membership_linked: ['Portal access enabled', 'Your agent account was linked to this portal.'],
            membership_reactivated: ['Portal access restored', 'Your access to this agent account was restored.'],
            membership_revoked: ['Portal access removed', 'Access to this agent account was removed.'],
            payout_submitted: ['Payout destination submitted', 'Your payout destination was submitted for verification.'],
            payout_verified: ['Payout destination verified', 'Your payout destination was verified.'],
            withdrawal_reserved: ['Withdrawal requested', 'Your withdrawal request was received and the funds were reserved.'],
            withdrawal_approved: ['Withdrawal approved', 'Your withdrawal request was approved.'],
            withdrawal_rejected: ['Withdrawal rejected', 'Your withdrawal request was rejected and the reserved funds were released.'],
            withdrawal_paid: ['Withdrawal paid', 'Your withdrawal was marked as paid.'],
        };
        const items = rows.map(r => {
            const [title, message] = Object.hasOwn(messages, r.code) ? messages[r.code]! : ['Account activity', 'An update was recorded for your agent account.'];
            return { id: r.id, createdAt: r.createdAt, title, message, withdrawalId: r.withdrawalId };
        });
        return { items, total: total!.value, page, perPage };
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
    return c.json({ success: true, data });
});
app.get('/:agentId/agreements', async c => {
    const m = await membershipFor(c.var.agentIdentity.user.id, c.req.param('agentId'));
    const { page, perPage } = pagination.parse(c.req.query());
    const where = and(eq(commissionAgreements.tenantAdminId, m.tenantAdminId), eq(commissionAgreements.agentId, m.agentId));
    const [total] = await db.select({ value: count() }).from(commissionAgreements).where(where);
    const items = await db.select({ id: commissionAgreements.id, scopeType: commissionAgreements.scopeType, rateBps: commissionAgreements.rateBps, basis: commissionAgreements.basis,
        effectiveFrom: commissionAgreements.effectiveFrom, createdAt: commissionAgreements.createdAt,
        isCurrent: sql<boolean>`${commissionAgreements.effectiveFrom} <= now() and not exists (select 1 from commission_agreement newer where newer.tenant_admin_id = ${commissionAgreements.tenantAdminId} and newer.scope_type = ${commissionAgreements.scopeType} and newer.scope_id = ${commissionAgreements.scopeId} and newer.effective_from <= now() and newer.effective_from > ${commissionAgreements.effectiveFrom})`,
    }).from(commissionAgreements).where(where).orderBy(desc(commissionAgreements.effectiveFrom), desc(commissionAgreements.id)).limit(perPage).offset((page - 1) * perPage);
    return c.json({ success: true, data: { items, total: total!.value, page, perPage } });
});
app.get('/:agentId/payout-profile', async c => {
    const m = await membershipFor(c.var.agentIdentity.user.id, c.req.param('agentId'));
    return c.json({ success: true, data: { profile: publicProfile(await latestPayout(db, m.id)) } });
});
app.post('/:agentId/payout-profile', async c => {
    const input = payoutInput.parse(await c.req.json());
    const m = await membershipFor(c.var.agentIdentity.user.id, c.req.param('agentId'));
    await stepUp(c.var.agentIdentity, c.req.raw.headers, input.password);
    const profile = await db.transaction(async tx => {
        await lockPortalAgent(tx, m.tenantAdminId, m.agentId);
        await portalMembership(tx, m.userId, m.agentId, true);
        const { password: _, ...fields } = input;
        const [row] = await tx.insert(agentPayoutProfiles).values({ ...fields, membershipId: m.id }).returning();
        await auditPortal(tx, m.id, 'AGENT', m.userId, 'payout_submitted', { profileId: row!.id });
        return row!;
    });
    return c.json({ success: true, data: { profile: publicProfile(profile) } }, 201);
});
app.get('/:agentId/withdrawals', async c => {
    const m = await membershipFor(c.var.agentIdentity.user.id, c.req.param('agentId'));
    const { page, perPage } = pagination.parse(c.req.query());
    const where = and(eq(commissionWithdrawals.tenantAdminId, m.tenantAdminId), eq(commissionWithdrawals.agentId, m.agentId));
    const [total] = await db.select({ value: count() }).from(commissionWithdrawals).where(where);
    const rows = await db.select().from(commissionWithdrawals).where(where).orderBy(desc(commissionWithdrawals.createdAt), desc(commissionWithdrawals.id)).limit(perPage).offset((page - 1) * perPage);
    return c.json({ success: true, data: { items: rows.map(publicWithdrawal), total: total!.value, page, perPage } });
});
app.get('/:agentId/withdrawal-intent', async c => {
    const m = await membershipFor(c.var.agentIdentity.user.id, c.req.param('agentId'));
    return c.json({ success: true, data: await withdrawalIntent(m.tenantAdminId, m.agentId, withdrawalActor(m.userId, m.agentId)) });
});
app.post('/:agentId/withdrawal-intent', async c => {
    const input = intentInput.parse(await c.req.json());
    const m = await membershipFor(c.var.agentIdentity.user.id, c.req.param('agentId'));
    return c.json({ success: true, data: await withdrawalIntent(m.tenantAdminId, m.agentId, withdrawalActor(m.userId, m.agentId), { ...input, previousIntentId: input.previousIntentId }) });
});
for (const action of ['acknowledge', 'cancel'] as const) {
    app.post(`/:agentId/withdrawal-intent/:intentId/${action}`, async c => {
        z.object({}).strict().parse(await c.req.json());
        const m = await membershipFor(c.var.agentIdentity.user.id, c.req.param('agentId'));
        await resolveWithdrawalIntent(m.tenantAdminId, m.agentId, c.req.param('intentId'), action === 'acknowledge' ? 'acknowledged' : 'cancelled', withdrawalActor(m.userId, m.agentId));
        return c.json({ success: true, data: null });
    });
}
app.post('/:agentId/withdrawals', async c => {
    const input = withdrawalInput.parse(await c.req.json());
    const m = await membershipFor(c.var.agentIdentity.user.id, c.req.param('agentId'));
    await stepUp(c.var.agentIdentity, c.req.raw.headers, input.password);
    const { password: _, ...fields } = input;
    const row = await reserveWithdrawal(m.tenantAdminId, m.agentId, fields, withdrawalActor(m.userId, m.agentId));
    return c.json({ success: true, data: publicWithdrawal(row) }, 201);
});
app.get('/:agentId/withdrawals/by-key/:idempotencyKey', async c => {
    const m = await membershipFor(c.var.agentIdentity.user.id, c.req.param('agentId'));
    const [row] = await db.select().from(commissionWithdrawals).where(and(eq(commissionWithdrawals.idempotencyKey, z.uuid().parse(c.req.param('idempotencyKey'))), eq(commissionWithdrawals.agentId, m.agentId), eq(commissionWithdrawals.tenantAdminId, m.tenantAdminId)));
    if (!row) throw new CommissionError(404, 'Withdrawal not found');
    return c.json({ success: true, data: publicWithdrawal(row) });
});
app.get('/:agentId/withdrawals/:withdrawalId', async c => {
    const m = await membershipFor(c.var.agentIdentity.user.id, c.req.param('agentId'));
    const [row] = await db.select().from(commissionWithdrawals).where(and(eq(commissionWithdrawals.id, z.uuid().parse(c.req.param('withdrawalId'))), eq(commissionWithdrawals.agentId, m.agentId), eq(commissionWithdrawals.tenantAdminId, m.tenantAdminId)));
    if (!row) throw new CommissionError(404, 'Withdrawal not found');
    const events = await db.select({ id: commissionWithdrawalEvents.id, status: commissionWithdrawalEvents.status, actorType: commissionWithdrawalEvents.actorType,
        reason: commissionWithdrawalEvents.reason, reference: commissionWithdrawalEvents.reference, createdAt: commissionWithdrawalEvents.createdAt })
        .from(commissionWithdrawalEvents).where(eq(commissionWithdrawalEvents.withdrawalId, row.id)).orderBy(commissionWithdrawalEvents.createdAt, commissionWithdrawalEvents.id);
    return c.json({ success: true, data: { withdrawal: publicWithdrawal(row), events } });
});
app.get('/:agentId/audit', async c => {
    const m = await membershipFor(c.var.agentIdentity.user.id, c.req.param('agentId'));
    const { page, perPage } = pagination.parse(c.req.query());
    const where = eq(agentPortalAudit.membershipId, m.id);
    const [total] = await db.select({ value: count() }).from(agentPortalAudit).where(where);
    const items = await db.select({ id: agentPortalAudit.id, action: agentPortalAudit.action, actorType: agentPortalAudit.actorType, createdAt: agentPortalAudit.createdAt })
        .from(agentPortalAudit).where(where).orderBy(desc(agentPortalAudit.createdAt), desc(agentPortalAudit.id)).limit(perPage).offset((page - 1) * perPage);
    return c.json({ success: true, data: { items, total: total!.value, page, perPage } });
});
export default app;
