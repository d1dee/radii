import { and, desc, eq, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { adminUser, commissionAgents, commissionAgreements, commissionJournal, commissionWithdrawalEvents, commissionWithdrawalIntents, commissionWithdrawals, confirmedCollections, nasDevice, pppoeServiceAccounts } from '../db/schema';

export type CommissionTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export class CommissionError extends Error {
    constructor(public status: 400 | 404 | 409, message: string) { super(message); }
}

export function cents(value: string): bigint {
    if (!/^(0|[1-9][0-9]{0,17})(\.[0-9]{1,2})?$/.test(value)) throw new CommissionError(400, 'Invalid money amount');
    const [whole, fraction = ''] = value.split('.');
    return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
}
export function money(value: bigint): string {
    const sign = value < 0n ? '-' : '';
    const abs = value < 0n ? -value : value;
    return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

function journalSnapshot(value: Record<string, unknown>) {
    // Bind serialized JSON as text so Bun does not JSON-encode it a second time.
    return sql`${JSON.stringify(value)}::text::jsonb`;
}

export async function ownedAgent(tx: CommissionTx | typeof db, tenant: string, id: string, lock = false) {
    z.string().uuid().parse(id);
    const query = tx.select().from(commissionAgents).where(and(eq(commissionAgents.id, id), eq(commissionAgents.tenantAdminId, tenant)));
    const [agent] = await (lock ? query.for('update') : query);
    if (!agent) throw new CommissionError(404, 'Agent not found');
    return agent;
}

// Serialize agreement creation with collection attribution within a tenant.
// Existing infrastructure ownership remains untouched.
async function lockTenant(tx: CommissionTx, tenant: string) {
    // NO KEY UPDATE serializes accounting without conflicting with FK KEY SHARE
    // locks already held by payment inserts in the enclosing transaction.
    await tx.select({ id: adminUser.id }).from(adminUser).where(eq(adminUser.id, tenant)).for('no key update');
}

export async function collectionConfirmationTime(tx: CommissionTx, tenant: string | null): Promise<Date> {
    if (tenant) await lockTenant(tx, tenant);
    const rows = await tx.execute<{ now: string }>(sql`select clock_timestamp()::text as now`);
    return new Date(rows[0]!.now);
}

export async function addAgreement(tenant: string, agentId: string, input: {
    scopeType: 'nas' | 'service_account'; scopeId: string; rateBps: number;
    basis: 'confirmed_collection_gross'; effectiveFrom?: string;
}) {
    return db.transaction(async tx => {
        await lockTenant(tx, tenant);
        const agent = await ownedAgent(tx, tenant, agentId, true);
        if (agent.status !== 'active') throw new CommissionError(409, 'Archived agents cannot receive new agreements');
        const scope = input.scopeType === 'nas'
            ? await tx.select({ id: nasDevice.id }).from(nasDevice).where(and(eq(nasDevice.id, input.scopeId), eq(nasDevice.ownerId, tenant)))
            : await tx.select({ id: pppoeServiceAccounts.id }).from(pppoeServiceAccounts).where(and(eq(pppoeServiceAccounts.id, input.scopeId), eq(pppoeServiceAccounts.tenantAdminId, tenant)));
        if (!scope.length) throw new CommissionError(404, 'Assignment scope not found');
        const [{ now }] = await tx.select({ now: sql<string>`clock_timestamp()::text` }).from(adminUser).where(eq(adminUser.id, tenant));
        const current = new Date(now!);
        const effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : current;
        if (effectiveFrom < current) throw new CommissionError(400, 'Agreements must be prospective');
        // Disallow a pre-existing future schedule from silently replacing a newer
        // agreement. Append later versions, rather than rewriting history.
        const [latest] = await tx.select().from(commissionAgreements).where(and(
            eq(commissionAgreements.tenantAdminId, tenant), eq(commissionAgreements.scopeType, input.scopeType), eq(commissionAgreements.scopeId, input.scopeId),
        )).orderBy(desc(commissionAgreements.effectiveFrom)).limit(1);
        if (latest && effectiveFrom <= latest.effectiveFrom) throw new CommissionError(409, 'Effective time must follow the latest scope agreement');
        const [row] = await tx.insert(commissionAgreements).values({ ...input, effectiveFrom, tenantAdminId: tenant, actorAdminId: tenant, agentId }).returning();
        return row!;
    });
}

// Called only for a newly inserted confirmed_collection, inside its transaction.
// Confirmation recordedAt is the entitlement time (not provider paid/initiated
// time). Unknown attribution is not inferred and historical events are not swept.
export async function accrueConfirmedCollection(tx: CommissionTx, collection: typeof confirmedCollections.$inferSelect) {
    const tenant = collection.tenantAdminId;
    if (!tenant || !/^[A-Z]{3}$/.test(collection.currency)) return;
    await lockTenant(tx, tenant);
    const scopes = [];
    if (collection.nasDeviceId) scopes.push(and(eq(commissionAgreements.scopeType, 'nas'), eq(commissionAgreements.scopeId, collection.nasDeviceId))!);
    if (collection.pppoeServiceAccountId) scopes.push(and(eq(commissionAgreements.scopeType, 'service_account'), eq(commissionAgreements.scopeId, collection.pppoeServiceAccountId))!);
    if (!scopes.length) return;
    const [agreement] = await tx.select().from(commissionAgreements).where(and(
        eq(commissionAgreements.tenantAdminId, tenant), lte(commissionAgreements.effectiveFrom, collection.recordedAt), or(...scopes),
    )).orderBy(desc(sql`case when ${commissionAgreements.scopeType} = 'service_account' then 1 else 0 end`), desc(commissionAgreements.effectiveFrom)).limit(1);
    if (!agreement) return;
    const agent = await ownedAgent(tx, tenant, agreement.agentId, true);
    if (agent.status !== 'active') return;
    const rounded = (cents(collection.amount) * BigInt(agreement.rateBps) + 5000n) / 10000n;
    if (rounded === 0n) return;
    const amount = money(rounded);
    await tx.insert(commissionJournal).values({
        tenantAdminId: tenant, agentId: agreement.agentId, currency: collection.currency,
        kind: 'accrual', amount, debitAccount: 'commission_expense', creditAccount: 'available', collectionId: collection.id,
        snapshot: journalSnapshot({ agreementId: agreement.id, agentId: agreement.agentId, scopeType: agreement.scopeType, scopeId: agreement.scopeId,
            rateBps: agreement.rateBps, basis: agreement.basis, effectiveFrom: agreement.effectiveFrom.toISOString(),
            collectionAmount: collection.amount, collectionRecordedAt: collection.recordedAt.toISOString(),
            transactionId: collection.transactionId, customerUserId: collection.customerUserId,
            nasDeviceId: collection.nasDeviceId, pppoeServiceAccountId: collection.pppoeServiceAccountId,
            rounding: 'half_up_minor_unit', entitlementTime: 'collection_recorded_at' }),
    }).onConflictDoNothing({ target: commissionJournal.collectionId });
}

export async function agentBalances(tx: CommissionTx | typeof db, tenant: string, agentId: string) {
    const rows = await tx.select({ currency: commissionJournal.currency,
        available: sql<string>`coalesce(sum(case when ${commissionJournal.creditAccount} = 'available' then ${commissionJournal.amount} when ${commissionJournal.debitAccount} = 'available' then -${commissionJournal.amount} else 0.00 end),0.00)::text`,
        reserved: sql<string>`coalesce(sum(case when ${commissionJournal.creditAccount} = 'reserved' then ${commissionJournal.amount} when ${commissionJournal.debitAccount} = 'reserved' then -${commissionJournal.amount} else 0.00 end),0.00)::text`,
        paid: sql<string>`coalesce(sum(case when ${commissionJournal.kind} = 'paid' then ${commissionJournal.amount} else 0.00 end),0.00)::text`,
        earned: sql<string>`coalesce(sum(case when ${commissionJournal.kind} = 'accrual' then ${commissionJournal.amount} else 0.00 end),0.00)::text`,
    }).from(commissionJournal).where(and(eq(commissionJournal.tenantAdminId, tenant), eq(commissionJournal.agentId, agentId))).groupBy(commissionJournal.currency);
    return rows;
}

type WithdrawalActor = {
    userId: string;
    authorize: (tx: CommissionTx) => Promise<unknown>;
    payout: (tx: CommissionTx) => Promise<Record<string, unknown>>;
};

function intentScope(tenant: string, agentId: string, actor?: WithdrawalActor) {
    return and(eq(commissionWithdrawalIntents.tenantAdminId, tenant), eq(commissionWithdrawalIntents.agentId, agentId),
        eq(commissionWithdrawalIntents.actorType, actor ? 'AGENT' : 'ADMIN'), eq(commissionWithdrawalIntents.actorUserId, actor?.userId ?? tenant));
}

function publicIntent(row: typeof commissionWithdrawalIntents.$inferSelect) {
    return { id: row.id, amount: row.amount, currency: row.currency, note: row.note, withdrawalId: row.withdrawalId };
}

// All intent and ledger mutations share the tenant -> agent -> membership lock
// order. The unresolved uniqueness constraint is a second line of defense.
export async function withdrawalIntent(tenant: string, agentId: string, actor?: WithdrawalActor, input?: {
    amount: string; currency: string; note?: string; previousIntentId: string | null;
}) {
    return db.transaction(async tx => {
        await lockTenant(tx, tenant);
        const agent = await ownedAgent(tx, tenant, agentId, true);
        if (actor) await actor.authorize(tx);
        const [latest] = await tx.select().from(commissionWithdrawalIntents).where(intentScope(tenant, agentId, actor))
            .orderBy(desc(commissionWithdrawalIntents.sequence)).limit(1);
        if (latest && !latest.resolution) return { intent: publicIntent(latest), previousIntentId: latest.id };
        if (!input) return { intent: null, previousIntentId: latest?.id ?? null };
        if (input.previousIntentId !== (latest?.id ?? null)) throw new CommissionError(409, 'Withdrawal request changed in another tab. Reload and review before starting a new request');
        if (agent.status !== 'active') throw new CommissionError(409, 'Archived agents cannot request withdrawals');
        const amount = money(cents(input.amount));
        if (cents(amount) === 0n) throw new CommissionError(400, 'Withdrawal amount must be positive');
        const payoutSnapshot = actor ? await actor.payout(tx) : undefined;
        const [row] = await tx.insert(commissionWithdrawalIntents).values({ tenantAdminId: tenant, agentId,
            actorType: actor ? 'AGENT' : 'ADMIN', actorUserId: actor?.userId ?? tenant,
            amount, currency: input.currency, note: input.note,
            ...(payoutSnapshot ? { payoutSnapshot: journalSnapshot(payoutSnapshot) } : {}) }).returning();
        return { intent: publicIntent(row!), previousIntentId: row!.id };
    });
}

async function ownedIntent(tx: CommissionTx, tenant: string, agentId: string, id: string, actor?: WithdrawalActor) {
    const [row] = await tx.select().from(commissionWithdrawalIntents).where(and(intentScope(tenant, agentId, actor), eq(commissionWithdrawalIntents.id, z.uuid().parse(id)))).for('update');
    if (!row) throw new CommissionError(404, 'Withdrawal intent not found');
    return row;
}

export async function resolveWithdrawalIntent(tenant: string, agentId: string, id: string, resolution: 'acknowledged' | 'cancelled', actor?: WithdrawalActor) {
    return db.transaction(async tx => {
        await lockTenant(tx, tenant);
        await ownedAgent(tx, tenant, agentId, true);
        if (actor) await actor.authorize(tx);
        const row = await ownedIntent(tx, tenant, agentId, id, actor);
        if (row.resolution === resolution) return;
        if (row.resolution || (resolution === 'acknowledged' ? !row.withdrawalId : !!row.withdrawalId))
            throw new CommissionError(409, 'Only confirmed requests can be acknowledged and only unreserved requests can be cancelled');
        await tx.update(commissionWithdrawalIntents).set({ resolution }).where(eq(commissionWithdrawalIntents.id, row.id));
    });
}

export async function reserveWithdrawal(tenant: string, agentId: string, input: { intentId: string }, actor?: WithdrawalActor) {
    return db.transaction(async tx => {
        await lockTenant(tx, tenant);
        const agent = await ownedAgent(tx, tenant, agentId, true);
        if (actor) await actor.authorize(tx);
        const intent = await ownedIntent(tx, tenant, agentId, input.intentId, actor);
        if (intent.withdrawalId) {
            const [existing] = await tx.select().from(commissionWithdrawals).where(and(eq(commissionWithdrawals.id, intent.withdrawalId), eq(commissionWithdrawals.tenantAdminId, tenant), eq(commissionWithdrawals.agentId, agentId)));
            if (!existing) throw new CommissionError(409, 'Withdrawal receipt is unavailable');
            return existing;
        }
        if (intent.resolution) throw new CommissionError(409, 'Withdrawal intent is cancelled');
        if (agent.status !== 'active') throw new CommissionError(409, 'Archived agents cannot request withdrawals');
        const payoutSnapshot = actor ? await actor.payout(tx) : undefined;
        if (actor && payoutSnapshot?.profileId !== intent.payoutSnapshot?.profileId) throw new CommissionError(409, 'Payout destination changed. Cancel this unreserved intent and review a new request');
        const { amount, currency, note } = intent;
        const balance = (await agentBalances(tx, tenant, agentId)).find(b => b.currency === currency);
        if (!balance || cents(balance.available) < cents(amount)) throw new CommissionError(409, 'Insufficient available commission');
        const [row] = await tx.insert(commissionWithdrawals).values({ amount, currency, note, idempotencyKey: intent.id, tenantAdminId: tenant, agentId,
            ...(payoutSnapshot ? { payoutSnapshot: journalSnapshot(payoutSnapshot) } : {}) }).returning();
        await tx.insert(commissionJournal).values({ tenantAdminId: tenant, agentId, currency, amount,
            kind: 'reserve', debitAccount: 'available', creditAccount: 'reserved', withdrawalId: row!.id,
            snapshot: journalSnapshot({ ...(actor ? { actorType: 'AGENT', actorAgentUserId: actor.userId } : { actorAdminId: tenant }), intentId: intent.id, note, ...(payoutSnapshot ? { payoutSnapshot } : {}) }) });
        await tx.insert(commissionWithdrawalEvents).values({ withdrawalId: row!.id, status: 'reserved',
            ...(actor ? { actorType: 'AGENT' as const, actorAgentUserId: actor.userId } : { actorAdminId: tenant }) });
        await tx.update(commissionWithdrawalIntents).set({ withdrawalId: row!.id }).where(eq(commissionWithdrawalIntents.id, intent.id));
        return row!;
    });
}

export async function updateAgent(tenant: string, agentId: string, input: { name?: string; phone?: string | null; notes?: string | null; status?: 'active' | 'archived' }) {
    return db.transaction(async tx => {
        await lockTenant(tx, tenant);
        await ownedAgent(tx, tenant, agentId, true);
        const [row] = await tx.update(commissionAgents).set(input).where(and(eq(commissionAgents.id, agentId), eq(commissionAgents.tenantAdminId, tenant))).returning();
        return row!;
    });
}

export async function transitionWithdrawal(tenant: string, agentId: string, id: string, action: 'approve' | 'reject' | 'paid', input: { reason?: string; reference?: string; evidence?: string }) {
    z.string().uuid().parse(id);
    return db.transaction(async tx => {
        await lockTenant(tx, tenant);
        await ownedAgent(tx, tenant, agentId, true);
        const [row] = await tx.select().from(commissionWithdrawals).where(and(eq(commissionWithdrawals.id, id), eq(commissionWithdrawals.agentId, agentId), eq(commissionWithdrawals.tenantAdminId, tenant))).for('update');
        if (!row) throw new CommissionError(404, 'Withdrawal not found');
        const status = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'paid';
        if (row.status === status) {
            const [event] = await tx.select().from(commissionWithdrawalEvents).where(and(eq(commissionWithdrawalEvents.withdrawalId, id), eq(commissionWithdrawalEvents.status, status)));
            if (event?.reason !== (input.reason ?? null) || event?.reference !== (input.reference ?? null) || event?.evidence !== (input.evidence ?? null)) throw new CommissionError(409, 'Transition already recorded with different details');
            return row;
        }
        if ((action === 'approve' && row.status !== 'reserved') || (action === 'reject' && !['reserved', 'approved'].includes(row.status)) || (action === 'paid' && row.status !== 'approved')) throw new CommissionError(409, 'Invalid withdrawal transition');
        if (action === 'reject' && !input.reason?.trim()) throw new CommissionError(400, 'Rejection reason is required');
        if (action === 'paid' && (!input.reference?.trim() || !input.evidence?.trim())) throw new CommissionError(400, 'External payment reference and evidence are required');
        const [updated] = await tx.update(commissionWithdrawals).set({ status, updatedAt: new Date(),
            ...(action === 'paid' ? { reference: input.reference, evidence: input.evidence } : {}),
        }).where(eq(commissionWithdrawals.id, id)).returning();
        await tx.insert(commissionWithdrawalEvents).values({ withdrawalId: id, status, actorAdminId: tenant, ...input });
        if (action !== 'approve') await tx.insert(commissionJournal).values({ tenantAdminId: tenant, agentId, currency: row.currency, amount: row.amount,
            withdrawalId: id, kind: action === 'reject' ? 'release' : 'paid', debitAccount: 'reserved', creditAccount: action === 'reject' ? 'available' : 'external_payment',
            snapshot: journalSnapshot({ actorAdminId: tenant, ...input }),
        });
        return updated!;
    });
}
