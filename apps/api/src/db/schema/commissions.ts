import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, numeric, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { adminUser } from './admin-auth-schema';

const createdAt = () => timestamp('created_at', { withTimezone: true, mode: 'date' }).default(sql`clock_timestamp()`).notNull();

// External personnel only: deliberately no auth user/session relationship.
export const commissionAgents = pgTable('commission_agent', {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantAdminId: text('tenant_admin_id').notNull().references(() => adminUser.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    phone: text('phone'),
    notes: text('notes'),
    status: text('status', { enum: ['active', 'archived'] }).default('active').notNull(),
    createdAt: createdAt(),
}, t => [index('commission_agent_tenant_idx').on(t.tenantAdminId), check('commission_agent_status_check', sql`${t.status} in ('active','archived')`)]);

// Append-only versions. Latest effective version for a scope wins, including
// zero-rate versions. Scope IDs are snapshots, never infrastructure ownership.
export const commissionAgreements = pgTable('commission_agreement', {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantAdminId: text('tenant_admin_id').notNull().references(() => adminUser.id, { onDelete: 'restrict' }),
    agentId: uuid('agent_id').notNull().references(() => commissionAgents.id, { onDelete: 'restrict' }),
    actorAdminId: text('actor_admin_id').notNull(),
    scopeType: text('scope_type', { enum: ['nas', 'service_account'] }).notNull(),
    scopeId: uuid('scope_id').notNull(),
    rateBps: integer('rate_bps').notNull(),
    basis: text('basis').notNull(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: createdAt(),
}, t => [
    unique('commission_agreement_scope_time_key').on(t.tenantAdminId, t.scopeType, t.scopeId, t.effectiveFrom),
    index('commission_agreement_agent_idx').on(t.tenantAdminId, t.agentId, t.effectiveFrom),
    check('commission_agreement_rate_check', sql`${t.rateBps} between 0 and 10000`),
    check('commission_agreement_basis_check', sql`${t.basis} = 'confirmed_collection_gross'`),
    check('commission_agreement_scope_check', sql`${t.scopeType} in ('nas','service_account')`),
]);

export const commissionWithdrawals = pgTable('commission_withdrawal', {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantAdminId: text('tenant_admin_id').notNull().references(() => adminUser.id, { onDelete: 'restrict' }),
    agentId: uuid('agent_id').notNull().references(() => commissionAgents.id, { onDelete: 'restrict' }),
    idempotencyKey: uuid('idempotency_key').notNull(),
    amount: numeric('amount', { precision: 20, scale: 2 }).notNull(),
    currency: text('currency').notNull(),
    note: text('note'),
    status: text('status', { enum: ['reserved', 'approved', 'rejected', 'paid'] }).default('reserved').notNull(),
    reference: text('reference'),
    evidence: text('evidence'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, t => [unique('commission_withdrawal_idempotency_key').on(t.tenantAdminId, t.idempotencyKey),
    index('commission_withdrawal_agent_idx').on(t.tenantAdminId, t.agentId, t.createdAt),
    check('commission_withdrawal_amount_check', sql`${t.amount} > 0`),
    check('commission_withdrawal_currency_check', sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check('commission_withdrawal_status_check', sql`${t.status} in ('reserved','approved','rejected','paid')`),
    check('commission_withdrawal_paid_evidence_check', sql`${t.status} <> 'paid' or (length(trim(${t.reference})) > 0 and length(trim(${t.evidence})) > 0 and ${t.reference} is not null and ${t.evidence} is not null)`),
]);

export const commissionWithdrawalEvents = pgTable('commission_withdrawal_event', {
    id: uuid('id').defaultRandom().primaryKey(),
    withdrawalId: uuid('withdrawal_id').notNull().references(() => commissionWithdrawals.id, { onDelete: 'restrict' }),
    status: text('status', { enum: ['reserved', 'approved', 'rejected', 'paid'] }).notNull(),
    actorAdminId: text('actor_admin_id').notNull(),
    reason: text('reason'),
    reference: text('reference'),
    evidence: text('evidence'),
    createdAt: createdAt(),
}, t => [unique('commission_withdrawal_event_status_key').on(t.withdrawalId, t.status)]);

// Each immutable row is a complete balanced two-account posting, not a mutable
// balance. Equal debit/credit amount is structural, so partial journals cannot
// be inserted. This is a commission subledger, not a general ledger.
export const commissionJournal = pgTable('commission_journal', {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantAdminId: text('tenant_admin_id').notNull().references(() => adminUser.id, { onDelete: 'restrict' }),
    agentId: uuid('agent_id').notNull().references(() => commissionAgents.id, { onDelete: 'restrict' }),
    currency: text('currency').notNull(),
    kind: text('kind', { enum: ['accrual', 'reserve', 'release', 'paid'] }).notNull(),
    amount: numeric('amount', { precision: 20, scale: 2 }).notNull(),
    debitAccount: text('debit_account').notNull(),
    creditAccount: text('credit_account').notNull(),
    collectionId: uuid('collection_id').unique(),
    withdrawalId: uuid('withdrawal_id').references(() => commissionWithdrawals.id, { onDelete: 'restrict' }),
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
}, t => [index('commission_journal_agent_idx').on(t.tenantAdminId, t.agentId, t.createdAt),
    unique('commission_journal_withdrawal_kind_key').on(t.withdrawalId, t.kind),
    check('commission_journal_amount_check', sql`${t.amount} >= 0`),
    check('commission_journal_currency_check', sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check('commission_journal_accounts_check', sql`
        (${t.kind} = 'accrual' and ${t.debitAccount} = 'commission_expense' and ${t.creditAccount} = 'available' and ${t.collectionId} is not null and ${t.withdrawalId} is null) or
        (${t.kind} = 'reserve' and ${t.debitAccount} = 'available' and ${t.creditAccount} = 'reserved' and ${t.withdrawalId} is not null and ${t.collectionId} is null) or
        (${t.kind} = 'release' and ${t.debitAccount} = 'reserved' and ${t.creditAccount} = 'available' and ${t.withdrawalId} is not null and ${t.collectionId} is null) or
        (${t.kind} = 'paid' and ${t.debitAccount} = 'reserved' and ${t.creditAccount} = 'external_payment' and ${t.withdrawalId} is not null and ${t.collectionId} is null)
    `),
]);
