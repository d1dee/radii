// Explicit opt-in, loopback-only fixture: real BetterAuth, routers and ledger;
// only database/config/email boundaries replaced. No API/WireGuard startup.
import { mock } from 'bun:test';
import { SQL } from 'bun';
import { eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import * as schema from '../db/schema';
import type { AppVariables } from '../types';

export async function createAgentPortalFixture() {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) throw new Error('TEST_DATABASE_URL must explicitly name a disposable database');
    const client = new SQL(url, { max: 10 });
    const db = drizzle({ client, schema });
    const origins = ['http://127.0.0.1:5200', 'http://localhost:5200', 'http://127.0.0.1:5199', 'http://localhost:5199', 'https://agents.test', 'https://admin.test'];
    const codes = new Map<string, string>();
    const config = { apiUrl: 'http://127.0.0.1:4314', agentBetterAuthSecret: 'agent-fixture-secret-independent-00000000000000',
        adminBetterAuthSecret: 'admin-fixture-secret-independent-00000000000000', agentFrontendUrls: origins, adminFrontendUrls: origins };
    mock.module('../db', () => ({ db }));
    mock.module('../env', () => ({ env: config }));
    mock.module('../lib/email', () => ({ sendAgentOtpEmail: async (input: { email: string; otp: string; type: string }) => { codes.set(`${input.email}:${input.type}`, input.otp); },
        sendAdminOtpEmail: async (input: { email: string; otp: string; type: string }) => { codes.set(`${input.email}:${input.type}`, input.otp); } }));
    const { agentAuth } = await import('../agentAuth');
    const { adminAuth } = await import('../adminAuth');
    const { default: portal } = await import('../routes/agentPortal');
    const { default: adminRoutes } = await import('../routes/commissions');
    const { linkPortalIdentity } = await import('../lib/agentPortal');
    const unique = crypto.randomUUID();
    const email = `agent-${unique}@example.test`, adminEmail = `admin-${unique}@example.test`, password = 'Fixture-Password-2026!';
    const signup = await agentAuth.api.signUpEmail({ body: { name: 'Portal fixture agent', email, password } });
    await agentAuth.api.verifyEmailOTP({ body: { email, otp: codes.get(`${email}:email-verification`)! } });
    const adminSignup = await adminAuth.api.signUpEmail({ body: { name: 'Portal fixture operator', email: adminEmail, password } });
    await adminAuth.api.verifyEmailOTP({ body: { email: adminEmail, otp: codes.get(`${adminEmail}:email-verification`)! } });
    const tenant = adminSignup.user.id;
    const [agent] = await db.insert(schema.commissionAgents).values({ tenantAdminId: tenant, name: 'Fixture External Agent' }).returning();
    const membership = await linkPortalIdentity(tenant, agent!.id, email);
    const [profile] = await db.insert(schema.agentPayoutProfiles).values({ membershipId: membership.id, method: 'mpesa', accountName: 'Fixture External Agent', destination: '+254712345608', verifiedAt: new Date(), verifiedBy: tenant, verificationEvidence: 'Isolated fixture identity and destination confirmed' }).returning();
    await db.insert(schema.commissionJournal).values({ tenantAdminId: tenant, agentId: agent!.id, kind: 'accrual', amount: '125.00', currency: 'KES', debitAccount: 'commission_expense', creditAccount: 'available', collectionId: crypto.randomUUID(),
        snapshot: sql`${JSON.stringify({ rateBps: 1250, basis: 'confirmed_collection_gross', scopeType: 'nas', collectionAmount: '1000.00', collectionRecordedAt: new Date().toISOString(), customerUserId: 'MUST-NOT-LEAK', password: 'MUST-NOT-LEAK' })}::text::jsonb` });
    const app = new Hono<{ Variables: AppVariables }>();
    app.use('*', cors({ origin: origins, credentials: true, allowHeaders: ['Content-Type'], allowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'] }));
    app.use('*', async (c, next) => {
        const session = await adminAuth.api.getSession({ headers: c.req.raw.headers });
        if (session) { c.set('admin', session.user); c.set('adminSession', session.session); }
        await next();
    });
    app.on(['GET', 'POST'], '/api/agents/auth/*', c => agentAuth.handler(c.req.raw));
    app.on(['GET', 'POST'], '/api/admin/auth/*', c => adminAuth.handler(c.req.raw));
    app.route('/api/agents', portal);
    app.route('/api/admin/agents', adminRoutes);
    const metadata = { tenant, agentId: agent!.id, membershipId: membership.id, profileId: profile!.id, userId: signup.user.id, email, adminEmail, password };
    // Deliberately only in this local test server, never mounted in production.
    app.get('/__fixture', c => c.json(metadata));
    app.get('/__fixture/otp', c => c.json({ otp: codes.get(`${c.req.query('email')}:${c.req.query('type') ?? 'email-verification'}`) ?? null }));
    async function cleanup() {
        const memberships = await db.select().from(schema.agentMemberships).where(eq(schema.agentMemberships.tenantAdminId, tenant));
        const ids = memberships.map(m => m.id);
        if (ids.length) {
            await db.delete(schema.agentPortalAudit).where(inArray(schema.agentPortalAudit.membershipId, ids));
            await db.delete(schema.agentPayoutProfiles).where(inArray(schema.agentPayoutProfiles.membershipId, ids));
            await db.delete(schema.agentMemberships).where(inArray(schema.agentMemberships.id, ids));
        }
        const withdrawals = await db.select().from(schema.commissionWithdrawals).where(eq(schema.commissionWithdrawals.tenantAdminId, tenant));
        if (withdrawals.length) await db.delete(schema.commissionWithdrawalEvents).where(inArray(schema.commissionWithdrawalEvents.withdrawalId, withdrawals.map(w => w.id)));
        await db.delete(schema.commissionJournal).where(eq(schema.commissionJournal.tenantAdminId, tenant));
        await db.delete(schema.commissionWithdrawalIntents).where(eq(schema.commissionWithdrawalIntents.tenantAdminId, tenant));
        await db.delete(schema.commissionWithdrawals).where(eq(schema.commissionWithdrawals.tenantAdminId, tenant));
        await db.delete(schema.commissionAgreements).where(eq(schema.commissionAgreements.tenantAdminId, tenant));
        await db.delete(schema.commissionAgents).where(eq(schema.commissionAgents.tenantAdminId, tenant));
        await db.delete(schema.adminUser).where(eq(schema.adminUser.id, tenant));
        // Tests may register extra identities; clean these explicitly in tests.
        await db.delete(schema.agentUser).where(eq(schema.agentUser.id, signup.user.id));
        await client.close();
    }
    return { app, db, client, agentAuth, adminAuth, codes, metadata, cleanup };
}

if (import.meta.main) {
    const fixture = await createAgentPortalFixture();
    const server = Bun.serve({ hostname: '127.0.0.1', port: Number(process.env.AGENT_FIXTURE_PORT || 4314), fetch: fixture.app.fetch });
    console.info('Agent portal fixture ready', { port: server.port, ...fixture.metadata });
    let stopping = false;
    const stop = async () => { if (stopping) return; stopping = true; await server.stop(true); await fixture.cleanup(); process.exit(0); };
    process.on('SIGINT', () => { void stop(); }); process.on('SIGTERM', () => { void stop(); });
}
