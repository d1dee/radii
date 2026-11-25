import { pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { activatedPackages } from './packages';
import { adminUser } from './admin-auth-schema';

// Independent of outbox retention: a restart or a pruned receipt must not
// generate a second reminder for the same subscription cycle.
export const pppoeExpiryReminders = pgTable('pppoe_expiry_reminder', {
    activationId: uuid('activation_id').notNull().references(() => activatedPackages.id, { onDelete: 'cascade' }),
    activatedAt: timestamp('activated_at', { withTimezone: true, mode: 'date' }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    adminId: text('admin_id').notNull().references(() => adminUser.id, { onDelete: 'cascade' }),
    batchId: uuid('batch_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.activationId, t.activatedAt, t.expiresAt] })]);
