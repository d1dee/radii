// Local-only browser integration fixture. Auth/config are injected; the router,
// accounting, confirmation recorder, constraints and PostgreSQL are real.
// Requires an explicitly disposable TEST_DATABASE_URL with schema already pushed.
import { mock } from 'bun:test';
import { SQL } from 'bun';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import * as schema from '../db/schema';
import type { AppVariables } from '../types';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL must name a disposable database');
const client = new SQL(url, { max: 8 });
const db = drizzle({ client, schema });
const origins = ['http://127.0.0.1:5199', 'http://localhost:5199'];
mock.module('../db', () => ({ db }));
mock.module('../env', () => ({ env: { adminFrontendUrls: origins } }));
const { default: routes } = await import('../routes/commissions');
const { addAgreement } = await import('../lib/commissions');
const { recordConfirmedCollection } = await import('../lib/payments/collections');
const tenant = crypto.randomUUID(), customerId = crypto.randomUUID(), nasId = crypto.randomUUID(), accountId = crypto.randomUUID(), packageId = crypto.randomUUID();
await db.insert(schema.adminUser).values({ id: tenant, name: 'Accounting browser fixture', email: `${tenant}@test.invalid`, emailVerified: true, role: 'admin' });
await db.insert(schema.user).values({ id: customerId, name: 'Fixture customer', email: `${customerId}@test.invalid` });
await db.insert(schema.nasDevice).values({ id: nasId, ownerId: tenant, name: 'Fixture router', ipAddress: '192.0.2.230' });
await db.insert(schema.pppoeServiceAccounts).values({ id: accountId, tenantAdminId: tenant, customerUserId: customerId, nasDeviceId: nasId, label: 'Fixture PPPoE account', username: `fixture-${accountId}`, normalizedPhone: '+254712345607' });
const [agent] = await db.insert(schema.commissionAgents).values({ tenantAdminId: tenant, name: 'Fixture Agent', phone: '+254712345607', notes: 'External personnel; no login' }).returning();
await addAgreement(tenant, agent!.id, { scopeType: 'nas', scopeId: nasId, rateBps: 1250, basis: 'confirmed_collection_gross' });
await db.insert(schema.packages).values({ id: packageId, title: 'Fixture package', createdBy: tenant, type: 'hotspot', category: 'test', sessionLength: 3600, price: '1000.00', maxDevices: 1, noExpiry: false, uploadRate: 1, downloadRate: 1, downloadQuota: 0, uploadQuota: 0 });
await db.transaction(async tx => {
    const [payment] = await tx.insert(schema.packagePayments).values({ userId: customerId, packageId, nasDeviceId: nasId, tenantAdminId: tenant, amount: '1000.00', phoneNumber: '254712345607', status: 'paid' }).returning();
    const [transaction] = await tx.insert(schema.transaction).values({ userId: customerId, type: 'income', status: 'completed', amount: '1000.00', currency: 'KES', provider: 'admin-cash', providerReference: 'FIXTURE-CASH' }).returning();
    await tx.update(schema.packagePayments).set({ transaction: transaction!.id }).where(eq(schema.packagePayments.id, payment!.id));
    await recordConfirmedCollection(tx, transaction!.id, 'admin_activation', 'cash');
});
const now = new Date().toISOString(), expiresAt = new Date(Date.now() + 86400000).toISOString();
const user = { id: tenant, name: 'Accounting browser fixture', email: `${tenant}@test.invalid`, emailVerified: true, role: 'admin', image: null, createdAt: now, updatedAt: now, banned: false };
const session = { id: crypto.randomUUID(), userId: tenant, token: 'local-test-fixture-not-a-real-session', expiresAt, createdAt: now, updatedAt: now, ipAddress: '127.0.0.1', userAgent: 'fixture' };
const app = new Hono<{ Variables: AppVariables }>();
app.use('*', cors({ origin: origins, credentials: true, allowHeaders: ['Content-Type'], allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] }));
app.use('*', async (c, next) => {
    c.set('admin', { ...user, createdAt: new Date(now), updatedAt: new Date(now) } as AppVariables['admin']);
    c.set('adminSession', { ...session, createdAt: new Date(now), updatedAt: new Date(now), expiresAt: new Date(expiresAt) } as AppVariables['adminSession']);
    await next();
});
app.get('/api/admin/auth/get-session', c => c.json({ user, session }));
app.get('/__fixture', c => c.json({ tenant, agentId: agent!.id, nasId, accountId, customerId, packageId }));
app.route('/api/admin/agents', routes);
const server = Bun.serve({ hostname: '127.0.0.1', port: 4312, fetch: app.fetch });
console.info('Commission fixture ready', { port: server.port, tenant, agentId: agent!.id, nasId, accountId });
let stopping = false;
async function shutdown() {
    if (stopping) return;
    stopping = true;
    await server.stop(true);
    try {
        const withdrawals = await db.select().from(schema.commissionWithdrawals).where(eq(schema.commissionWithdrawals.tenantAdminId, tenant));
        for (const row of withdrawals) await db.delete(schema.commissionWithdrawalEvents).where(eq(schema.commissionWithdrawalEvents.withdrawalId, row.id));
        await db.delete(schema.commissionJournal).where(eq(schema.commissionJournal.tenantAdminId, tenant));
        await db.delete(schema.commissionWithdrawals).where(eq(schema.commissionWithdrawals.tenantAdminId, tenant));
        await db.delete(schema.commissionAgreements).where(eq(schema.commissionAgreements.tenantAdminId, tenant));
        await db.delete(schema.commissionAgents).where(eq(schema.commissionAgents.tenantAdminId, tenant));
        await db.delete(schema.confirmedCollections).where(eq(schema.confirmedCollections.tenantAdminId, tenant));
        await db.delete(schema.packagePayments).where(eq(schema.packagePayments.tenantAdminId, tenant));
        await db.delete(schema.transaction).where(eq(schema.transaction.userId, customerId));
        await db.delete(schema.packages).where(eq(schema.packages.id, packageId));
        await db.delete(schema.pppoeServiceAccounts).where(eq(schema.pppoeServiceAccounts.id, accountId));
        await db.delete(schema.nasDevice).where(eq(schema.nasDevice.id, nasId));
        await db.delete(schema.user).where(eq(schema.user.id, customerId));
        await db.delete(schema.adminUser).where(eq(schema.adminUser.id, tenant));
    } finally { await client.close(); process.exit(0); }
}
process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
