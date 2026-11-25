import { jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import type { WhatsAppOutboxState } from '../../lib/wahaOutbox';
import { adminUser } from './admin-auth-schema';

export const whatsappOutbox = pgTable('whatsapp_outbox', {
    sessionKey: text('session_key').primaryKey(),
    adminId: text('admin_id').notNull().references(() => adminUser.id, { onDelete: 'cascade' }),
    state: jsonb('state').$type<WhatsAppOutboxState>().notNull(),
});
