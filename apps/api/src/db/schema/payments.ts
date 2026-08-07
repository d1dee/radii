import { relations } from 'drizzle-orm';
import {
    index,
    jsonb,
    numeric,
    pgTable,
    text,
    timestamp,
} from 'drizzle-orm/pg-core';
import { user } from './auth-schema';

export const transaction = pgTable(
    'transaction',
    {
        id: text('id').primaryKey(),
        userId: text('user_id')
            .notNull()
            .references(() => user.id, { onDelete: 'cascade' }),
        type: text('type', {
            enum: ['income', 'expense', 'transfer', 'adjustment'],
        }).notNull(),
        amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
        currency: text('currency').default('KES').notNull(),
        status: text('status', {
            enum: ['pending', 'completed', 'failed', 'reversed'],
        })
            .default('pending')
            .notNull(),
        provider: text('provider').notNull(),
        providerTransactionId: text('provider_transaction_id'),
        providerReference: text('provider_reference'),
        description: text('description'),
        metadata: jsonb('metadata'),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
            .defaultNow()
            .notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (table) => [
        index('transaction_user_id_idx').on(table.userId),
        index('transaction_provider_idx').on(table.provider),
        index('transaction_provider_transaction_id_idx').on(
            table.providerTransactionId,
        ),
        index('transaction_status_idx').on(table.status),
    ],
);

export const transactionLog = pgTable(
    'transaction_log',
    {
        id: text('id').primaryKey(),
        transactionId: text('transaction_id')
            .notNull()
            .references(() => transaction.id, { onDelete: 'cascade' }),
        provider: text('provider').notNull(),
        eventType: text('event_type').notNull(),
        payload: jsonb('payload').notNull(),
        providerRequestId: text('provider_request_id'),
        providerConversationId: text('provider_conversation_id'),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
            .defaultNow()
            .notNull(),
    },
    (table) => [
        index('transaction_log_transaction_id_idx').on(table.transactionId),
        index('transaction_log_provider_idx').on(table.provider),
        index('transaction_log_event_type_idx').on(table.eventType),
    ],
);

export const transactionRelations = relations(transaction, ({ one, many }) => ({
    user: one(user, {
        fields: [transaction.userId],
        references: [user.id],
    }),
    logs: many(transactionLog),
}));

export const transactionLogRelations = relations(transactionLog, ({ one }) => ({
    transaction: one(transaction, {
        fields: [transactionLog.transactionId],
        references: [transaction.id],
    }),
}));
