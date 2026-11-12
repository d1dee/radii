import { sql } from 'drizzle-orm';
import { boolean, check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { adminUser } from './admin-auth-schema';
import { commissionAgents } from './commissions';

const created = () => timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull();
const updated = () => timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().$onUpdate(() => new Date()).notNull();

// A third authentication boundary, with no administrator roles or customer PINs.
export const agentUser = pgTable('agent_user', {
    id: text('id').primaryKey(), name: text('name').notNull(), email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').default(false).notNull(), image: text('image'), createdAt: created(), updatedAt: updated(),
});
export const agentSession = pgTable('agent_session', {
    id: text('id').primaryKey(), userId: text('user_id').notNull().references(() => agentUser.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(), expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'), userAgent: text('user_agent'), createdAt: created(), updatedAt: updated(),
}, t => [index('agent_session_user_idx').on(t.userId)]);
export const agentAccount = pgTable('agent_account', {
    id: text('id').primaryKey(), userId: text('user_id').notNull().references(() => agentUser.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(), providerId: text('provider_id').notNull(), password: text('password'),
    accessToken: text('access_token'), refreshToken: text('refresh_token'), idToken: text('id_token'), scope: text('scope'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }), refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    createdAt: created(), updatedAt: updated(),
}, t => [index('agent_account_user_idx').on(t.userId)]);
export const agentVerification = pgTable('agent_verification', {
    id: text('id').primaryKey(), identifier: text('identifier').notNull(), value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), createdAt: created(), updatedAt: updated(),
}, t => [index('agent_verification_identifier_idx').on(t.identifier)]);

// One permanent identity per accounting record. Revoke/reactivate rather than
// reassigning historical money to a different login. One login can span tenants.
export const agentMemberships = pgTable('agent_membership', {
    id: uuid('id').defaultRandom().primaryKey(), agentId: uuid('agent_id').notNull().unique().references(() => commissionAgents.id, { onDelete: 'restrict' }),
    tenantAdminId: text('tenant_admin_id').notNull().references(() => adminUser.id, { onDelete: 'restrict' }),
    userId: text('user_id').notNull().references(() => agentUser.id, { onDelete: 'restrict' }),
    status: text('status', { enum: ['active', 'revoked'] }).default('active').notNull(), createdAt: created(), updatedAt: updated(),
}, t => [index('agent_membership_user_idx').on(t.userId), check('agent_membership_status_check', sql`${t.status} in ('active','revoked')`)]);

// Append-only destination versions. A replacement always requires fresh admin
// verification; reservation snapshots retain the exact verified version.
export const agentPayoutProfiles = pgTable('agent_payout_profile', {
    id: uuid('id').defaultRandom().primaryKey(), membershipId: uuid('membership_id').notNull().references(() => agentMemberships.id, { onDelete: 'restrict' }),
    method: text('method', { enum: ['mpesa', 'bank'] }).notNull(), accountName: text('account_name').notNull(), destination: text('destination').notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }), verifiedBy: text('verified_by'), verificationEvidence: text('verification_evidence'),
    createdAt: timestamp('created_at', { withTimezone: true }).default(sql`clock_timestamp()`).notNull(),
}, t => [index('agent_payout_membership_idx').on(t.membershipId, t.createdAt), check('agent_payout_method_check', sql`${t.method} in ('mpesa','bank')`)]);
export const agentPortalAudit = pgTable('agent_portal_audit', {
    id: uuid('id').defaultRandom().primaryKey(), membershipId: uuid('membership_id').notNull().references(() => agentMemberships.id, { onDelete: 'restrict' }),
    actorType: text('actor_type', { enum: ['ADMIN', 'AGENT'] }).notNull(), actorId: text('actor_id').notNull(), action: text('action').notNull(),
    details: jsonb('details').$type<Record<string, unknown>>().notNull(), createdAt: created(),
}, t => [index('agent_portal_audit_membership_idx').on(t.membershipId, t.createdAt)]);
