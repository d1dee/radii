import { index, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Append-only integration events, not a commission ledger. Attribution is a
// snapshot: deliberately no cascading foreign keys to mutable/deletable sources.
// Consumers must deduplicate by id and durably track their processed event IDs.
export const confirmedCollections = pgTable('confirmed_collection', {
    id: uuid('id').defaultRandom().primaryKey(),
    transactionId: uuid('transaction_id').notNull().unique(),
    packagePaymentId: uuid('package_payment_id').notNull(),
    customerUserId: text('customer_user_id').notNull(),
    tenantAdminId: text('tenant_admin_id'),
    nasDeviceId: uuid('nas_device_id'),
    pppoeServiceAccountId: uuid('pppoe_service_account_id'),
    packageId: uuid('package_id').notNull(),
    // Same exact decimal representation/scale as the source transaction; never
    // convert through a JavaScript number or infer money from today's price.
    amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
    currency: text('currency').notNull(),
    provider: text('provider').notNull(),
    providerReference: text('provider_reference'),
    providerTransactionId: text('provider_transaction_id'),
    source: text('source', { enum: ['gateway', 'admin_activation'] }).notNull(),
    confirmationSource: text('confirmation_source').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true, mode: 'date' })
        .defaultNow().notNull(),
}, (table) => [
    index('confirmed_collection_cursor_idx').on(table.recordedAt, table.id),
    index('confirmed_collection_tenant_idx').on(table.tenantAdminId),
]);
