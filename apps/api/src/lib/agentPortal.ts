import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { adminUser, agentMemberships, agentPayoutProfiles, agentPortalAudit, agentUser, commissionAgents } from '../db/schema';
import { CommissionError, ownedAgent, type CommissionTx } from './commissions';

export async function portalMembership(tx: typeof db | CommissionTx, userId: string, agentId: string, lock = false) {
    const query = tx.select({ membership: agentMemberships, agent: commissionAgents }).from(agentMemberships)
        .innerJoin(commissionAgents, and(eq(commissionAgents.id, agentMemberships.agentId), eq(commissionAgents.tenantAdminId, agentMemberships.tenantAdminId)))
        .where(and(eq(agentMemberships.userId, userId), eq(agentMemberships.agentId, agentId), eq(agentMemberships.status, 'active'), eq(commissionAgents.status, 'active')));
    const [row] = await (lock ? query.for('update', { of: agentMemberships }) : query);
    if (!row) throw new CommissionError(404, 'Active agent membership not found');
    return row.membership;
}

export async function lockPortalAgent(tx: CommissionTx, tenant: string, agentId: string) {
    // Same ordering as all ledger writes, avoiding FK/financial lock inversions.
    await tx.select({ id: adminUser.id }).from(adminUser).where(eq(adminUser.id, tenant)).for('no key update');
    const agent = await ownedAgent(tx, tenant, agentId, true);
    return agent;
}

export async function latestPayout(tx: typeof db | CommissionTx, membershipId: string) {
    const [row] = await tx.select().from(agentPayoutProfiles).where(eq(agentPayoutProfiles.membershipId, membershipId))
        .orderBy(desc(agentPayoutProfiles.createdAt), desc(agentPayoutProfiles.id)).limit(1);
    return row ?? null;
}

export function auditPortal(tx: CommissionTx, membershipId: string, actorType: 'ADMIN' | 'AGENT', actorId: string, action: string, details: Record<string, unknown> = {}) {
    return tx.insert(agentPortalAudit).values({ membershipId, actorType, actorId, action, details: sql`${JSON.stringify(details)}::text::jsonb` });
}

export async function linkPortalIdentity(tenant: string, agentId: string, email: string) {
    return db.transaction(async tx => {
        const agent = await lockPortalAgent(tx, tenant, agentId);
        if (agent.status !== 'active') throw new CommissionError(409, 'Archived agents cannot be linked');
        const [identity] = await tx.select().from(agentUser).where(and(eq(agentUser.email, email.toLowerCase()), eq(agentUser.emailVerified, true)));
        if (!identity) throw new CommissionError(404, 'No verified agent portal registration for that email');
        const [existing] = await tx.select().from(agentMemberships).where(eq(agentMemberships.agentId, agentId)).for('update');
        if (existing && existing.userId !== identity.id) throw new CommissionError(409, 'Agent record is permanently linked to another identity; revoke access instead');
        if (existing?.status === 'active') return existing;
        const [row] = existing
            ? await tx.update(agentMemberships).set({ status: 'active', updatedAt: new Date() }).where(eq(agentMemberships.id, existing.id)).returning()
            : await tx.insert(agentMemberships).values({ tenantAdminId: tenant, agentId, userId: identity.id }).returning();
        await auditPortal(tx, row!.id, 'ADMIN', tenant, existing ? 'membership_reactivated' : 'membership_linked');
        return row!;
    });
}

export async function authorizeAgentWithdrawal(tx: CommissionTx, userId: string, agentId: string) {
    const membership = await portalMembership(tx, userId, agentId, true);
    const payout = await latestPayout(tx, membership.id);
    if (!payout?.verifiedAt) throw new CommissionError(409, 'An administrator must verify your current payout destination before withdrawal');
    return { profileId: payout.id, method: payout.method, accountName: payout.accountName, destination: payout.destination,
        verifiedAt: payout.verifiedAt.toISOString(), verifiedBy: payout.verifiedBy };
}
