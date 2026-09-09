// Per-admin console settings. One row per admin_user (PK is the admin id),
// holding the validated settings document from @radii/shared
// (adminSettingsSchema): appearance/time formatting, dashboard & interface
// defaults, and the admin's own M-Pesa credentials. These settings only ever
// affect the owning admin; the server-wide env configuration remains the
// fallback (payments fall back to it when mpesa.useOwnCredentials is false).

import { relations } from 'drizzle-orm';
import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { adminUser } from './admin-auth-schema';

export const adminSetting = pgTable('admin_setting', {
    adminUserId: text('admin_user_id')
        .primaryKey()
        .references(() => adminUser.id, { onDelete: 'cascade' }),
    settings: jsonb('settings').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
        .defaultNow()
        .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
        .defaultNow()
        .$onUpdate(() => /* @__PURE__ */ new Date())
        .notNull(),
});

export const adminSettingRelations = relations(adminSetting, ({ one }) => ({
    adminUser: one(adminUser, {
        fields: [adminSetting.adminUserId],
        references: [adminUser.id],
    }),
}));
