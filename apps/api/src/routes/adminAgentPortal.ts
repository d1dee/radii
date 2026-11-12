import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db';
import { agentMemberships, agentPayoutProfiles, agentUser } from '../db/schema';
import { auditPortal, latestPayout, linkPortalIdentity, lockPortalAgent } from '../lib/agentPortal';
import { CommissionError, ownedAgent } from '../lib/commissions';
import type { AppVariables } from '../types';

// Mounted under the existing requireAdmin + origin/JSON-protected router.
const app = new Hono<{ Variables: AppVariables }>();
app.get('/', async c => {
    const tenant = c.var.adminSession.userId, agentId = z.uuid().parse(c.req.param('agentId'));
    await ownedAgent(db, tenant, agentId);
    const [row] = await db.select({ membership: agentMemberships, email: agentUser.email, name: agentUser.name }).from(agentMemberships)
        .innerJoin(agentUser, eq(agentUser.id, agentMemberships.userId)).where(and(eq(agentMemberships.agentId, agentId), eq(agentMemberships.tenantAdminId, tenant)));
    return c.json({ success: true, data: { membership: row ? { ...row.membership, email: row.email, name: row.name } : null,
        payoutProfile: row ? await latestPayout(db, row.membership.id) : null } });
});
app.post('/', async c => {
    const { email } = z.object({ email: z.email().max(254).transform(s => s.toLowerCase()) }).strict().parse(await c.req.json());
    return c.json({ success: true, data: await linkPortalIdentity(c.var.adminSession.userId, z.uuid().parse(c.req.param('agentId')), email) }, 201);
});
app.post('/revoke', async c => {
    z.object({}).strict().parse(await c.req.json());
    const data = await db.transaction(async tx => {
        await lockPortalAgent(tx, c.var.adminSession.userId, z.uuid().parse(c.req.param('agentId')));
        const [membership] = await tx.update(agentMemberships).set({ status: 'revoked', updatedAt: new Date() })
            .where(and(eq(agentMemberships.agentId, c.req.param('agentId')!), eq(agentMemberships.tenantAdminId, c.var.adminSession.userId))).returning();
        if (!membership) throw new CommissionError(404, 'Membership not found');
        await auditPortal(tx, membership.id, 'ADMIN', c.var.adminSession.userId, 'membership_revoked');
        return membership;
    });
    return c.json({ success: true, data });
});
app.post('/payout-profiles/:profileId/verify', async c => {
    const { evidence } = z.object({ evidence: z.string().trim().min(1).max(2000) }).strict().parse(await c.req.json());
    const data = await db.transaction(async tx => {
        const agent = await lockPortalAgent(tx, c.var.adminSession.userId, z.uuid().parse(c.req.param('agentId')));
        const [membership] = await tx.select().from(agentMemberships).where(and(eq(agentMemberships.agentId, agent.id), eq(agentMemberships.tenantAdminId, c.var.adminSession.userId))).for('update');
        if (!membership || membership.status !== 'active' || agent.status !== 'active') throw new CommissionError(409, 'Active agent membership required');
        const profile = await latestPayout(tx, membership.id);
        if (!profile || profile.id !== z.uuid().parse(c.req.param('profileId'))) throw new CommissionError(409, 'Only the current payout profile can be verified');
        if (profile.verifiedAt) return profile;
        const [row] = await tx.update(agentPayoutProfiles).set({ verifiedAt: new Date(), verifiedBy: c.var.adminSession.userId, verificationEvidence: evidence }).where(eq(agentPayoutProfiles.id, profile.id)).returning();
        await auditPortal(tx, membership.id, 'ADMIN', c.var.adminSession.userId, 'payout_verified', { profileId: profile.id });
        return row!;
    });
    return c.json({ success: true, data });
});
export default app;
