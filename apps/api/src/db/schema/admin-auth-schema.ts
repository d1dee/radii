// Dedicated BetterAuth tables for the admin-console instance
// (apps/api/src/adminAuth.ts). Fully isolated from the customer `user`
// tables in auth-schema.ts: admins register on the /admin page and never
// share sessions, accounts or verifications with portal customers.
//
// Domain ownership flows from here: nas_device.owner_id and
// user_flag.created_by reference admin_user.id; every other user_id
// column in the schema references the customer `user` table.

import { relations } from 'drizzle-orm';
import {
    boolean,
    index,
    pgTable,
    text,
    timestamp,
} from 'drizzle-orm/pg-core';

export const adminUser = pgTable('admin_user', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').default(false).notNull(),
    image: text('image'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
        .defaultNow()
        .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
        .defaultNow()
        .$onUpdate(() => /* @__PURE__ */ new Date())
        .notNull(),
    role: text('role'),
    banned: boolean('banned').default(false),
    banReason: text('ban_reason'),
    banExpires: timestamp('ban_expires', { withTimezone: true, mode: 'date' }),
});

export const adminSession = pgTable(
    'admin_session',
    {
        id: text('id').primaryKey(),
        expiresAt: timestamp('expires_at', {
            withTimezone: true,
            mode: 'date',
        }).notNull(),
        token: text('token').notNull().unique(),
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
            .$onUpdate(() => /* @__PURE__ */ new Date())
            .notNull(),
        ipAddress: text('ip_address'),
        userAgent: text('user_agent'),
        userId: text('user_id')
            .notNull()
            .references(() => adminUser.id, { onDelete: 'cascade' }),
        impersonatedBy: text('impersonated_by'),
    },
    (table) => [index('admin_session_userId_idx').on(table.userId)],
);

export const adminAccount = pgTable(
    'admin_account',
    {
        id: text('id').primaryKey(),
        accountId: text('account_id').notNull(),
        providerId: text('provider_id').notNull(),
        userId: text('user_id')
            .notNull()
            .references(() => adminUser.id, { onDelete: 'cascade' }),
        accessToken: text('access_token'),
        refreshToken: text('refresh_token'),
        idToken: text('id_token'),
        accessTokenExpiresAt: timestamp('access_token_expires_at', {
            withTimezone: true,
            mode: 'date',
        }),
        refreshTokenExpiresAt: timestamp('refresh_token_expires_at', {
            withTimezone: true,
            mode: 'date',
        }),
        scope: text('scope'),
        password: text('password'),
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
            .$onUpdate(() => /* @__PURE__ */ new Date())
            .notNull(),
    },
    (table) => [index('admin_account_userId_idx').on(table.userId)],
);

export const adminVerification = pgTable(
    'admin_verification',
    {
        id: text('id').primaryKey(),
        identifier: text('identifier').notNull(),
        value: text('value').notNull(),
        expiresAt: timestamp('expires_at', {
            withTimezone: true,
            mode: 'date',
        }).notNull(),
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
            .$onUpdate(() => /* @__PURE__ */ new Date())
            .notNull(),
    },
    (table) => [
        index('admin_verification_identifier_idx').on(table.identifier),
    ],
);

export const adminUserRelations = relations(adminUser, ({ many }) => ({
    sessions: many(adminSession),
    accounts: many(adminAccount),
}));

export const adminSessionRelations = relations(adminSession, ({ one }) => ({
    user: one(adminUser, {
        fields: [adminSession.userId],
        references: [adminUser.id],
    }),
}));

export const adminAccountRelations = relations(adminAccount, ({ one }) => ({
    user: one(adminUser, {
        fields: [adminAccount.userId],
        references: [adminUser.id],
    }),
}));
