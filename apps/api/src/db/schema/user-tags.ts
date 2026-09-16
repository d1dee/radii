import { relations } from 'drizzle-orm';
import { pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { adminUser } from './admin-auth-schema';
import { user } from './auth-schema';

// Per-admin CRM tags for customers: a friendly name and location that only
// the tagging admin sees. Customer identity (phone/username) is untouched;
// both fields are optional and editable as information becomes available.
export const userAdminTag = pgTable(
    'user_admin_tag',
    {
        id: uuid('id').defaultRandom().primaryKey(),
        adminId: text('admin_id')
            .notNull()
            .references(() => adminUser.id, { onDelete: 'cascade' }),
        userId: text('user_id')
            .notNull()
            .references(() => user.id, { onDelete: 'cascade' }),
        name: text('name'),
        location: text('location'),
        createdAt: timestamp('created_at', {
            withTimezone: true,
            mode: 'date',
        })
            .defaultNow()
            .notNull(),
        updatedAt: timestamp('updated_at', {
            withTimezone: true,
            mode: 'date',
        })
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (table) => [unique('user_admin_tag_admin_user_key').on(table.adminId, table.userId)],
);

export const userAdminTagRelations = relations(userAdminTag, ({ one }) => ({
    admin: one(adminUser, {
        fields: [userAdminTag.adminId],
        references: [adminUser.id],
    }),
    customer: one(user, {
        fields: [userAdminTag.userId],
        references: [user.id],
    }),
}));
