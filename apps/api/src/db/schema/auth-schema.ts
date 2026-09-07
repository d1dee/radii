import { relations } from 'drizzle-orm';
import {
    boolean,
    index,
    pgTable,
    text,
    timestamp,
    uuid,
} from 'drizzle-orm/pg-core';
import { adminUser } from './admin-auth-schema';

export const user = pgTable('user', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').default(false).notNull(),
    image: text('image'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
        .defaultNow()
        .$onUpdate(() => /* @__PURE__ */ new Date())
        .notNull(),
    username: text('username').unique(),
    displayUsername: text('display_username'),
    role: text('role'),
    banned: boolean('banned').default(false),
    banReason: text('ban_reason'),
    banExpires: timestamp('ban_expires', { withTimezone: true, mode: 'date' }),
});

export const session = pgTable(
    'session',
    {
        id: text('id').primaryKey(),
        expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
        token: text('token').notNull().unique(),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
            .$onUpdate(() => /* @__PURE__ */ new Date())
            .notNull(),
        ipAddress: text('ip_address'),
        userAgent: text('user_agent'),
        userId: text('user_id')
            .notNull()
            .references(() => user.id, { onDelete: 'cascade' }),
        impersonatedBy: text('impersonated_by'),
    },
    (table) => [index('session_userId_idx').on(table.userId)],
);

export const account = pgTable(
    'account',
    {
        id: text('id').primaryKey(),
        accountId: text('account_id').notNull(),
        providerId: text('provider_id').notNull(),
        userId: text('user_id')
            .notNull()
            .references(() => user.id, { onDelete: 'cascade' }),
        accessToken: text('access_token'),
        refreshToken: text('refresh_token'),
        idToken: text('id_token'),
        accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true, mode: 'date' }),
        refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true, mode: 'date' }),
        scope: text('scope'),
        password: text('password'),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
            .$onUpdate(() => /* @__PURE__ */ new Date())
            .notNull(),
    },
    (table) => [index('account_userId_idx').on(table.userId)],
);

export const verification = pgTable(
    'verification',
    {
        id: text('id').primaryKey(),
        identifier: text('identifier').notNull(),
        value: text('value').notNull(),
        expiresAt: timestamp('expires_at',{ withTimezone: true, mode: 'date' }).notNull(),
        createdAt: timestamp('created_at',{ withTimezone: true, mode: 'date' }).defaultNow().notNull(),
        updatedAt: timestamp('updated_at',{ withTimezone: true, mode: 'date' })
            .defaultNow()
            .$onUpdate(() => /* @__PURE__ */ new Date())
            .notNull(),
    },
    (table) => [index('verification_identifier_idx').on(table.identifier)],
);

// Admin moderation flag on a customer user. Multiple flags accumulate so a
// user can be flagged for several independent reasons; removing a flag deletes
// the row. A user is considered "flagged" while at least one row exists.
//
// created_by references the ADMIN instance's user table (admin_user from
// admin-auth-schema.ts), not the customer `user` table below.
export const userFlag = pgTable(
    'user_flag',
    {
        id: uuid('id').defaultRandom().primaryKey(),
        userId: text('user_id')
            .notNull()
            .references(() => user.id, { onDelete: 'cascade' }),
        reason: text('reason').notNull(),
        note: text('note'),
        // The admin user who raised the flag (admin-auth-schema.ts).
        createdBy: text('created_by').references(() => adminUser.id, {
            onDelete: 'set null',
        }),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
            .defaultNow()
            .notNull(),
    },
    (table) => [index('user_flag_user_id_idx').on(table.userId)],
);

export const userRelations = relations(user, ({ many }) => ({
    sessions: many(session),
    accounts: many(account),
    flags: many(userFlag),
}));

export const userFlagRelations = relations(userFlag, ({ one }) => ({
    user: one(user, {
        fields: [userFlag.userId],
        references: [user.id],
    }),
    creator: one(adminUser, {
        fields: [userFlag.createdBy],
        references: [adminUser.id],
    }),
}));

export const sessionRelations = relations(session, ({ one }) => ({
    user: one(user, {
        fields: [session.userId],
        references: [user.id],
    }),
}));

export const accountRelations = relations(account, ({ one }) => ({
    user: one(user, {
        fields: [account.userId],
        references: [user.id],
    }),
}));
