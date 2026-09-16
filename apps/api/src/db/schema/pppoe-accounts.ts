import { relations, sql } from 'drizzle-orm';
import {
    check,
    index,
    pgTable,
    text,
    timestamp,
    unique,
    uuid,
} from 'drizzle-orm/pg-core';
import { adminUser } from './admin-auth-schema';
import { user } from './auth-schema';

export const pppoeServiceAccounts = pgTable(
    'pppoe_service_account',
    {
        id: uuid('id').defaultRandom().primaryKey(),
        customerUserId: text('customer_user_id')
            .references(() => user.id, { onDelete: 'set null' }),
        tenantAdminId: text('tenant_admin_id')
            .notNull()
            .references(() => adminUser.id, { onDelete: 'restrict' }),
        normalizedPhone: text('normalized_phone').notNull(),
        username: text('username').notNull(),
        claimCodeHash: text('claim_code_hash'),
        label: text('label'),
        status: text('status', { enum: ['active', 'suspended', 'closed'] })
            .default('active')
            .notNull(),
        lastUsedAt: timestamp('last_used_at', {
            withTimezone: true,
            mode: 'date',
        }),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
            .defaultNow()
            .notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (table) => [
        unique('pppoe_service_account_customer_tenant_key').on(
            table.customerUserId,
            table.tenantAdminId,
        ),
        unique('pppoe_service_account_tenant_phone_key').on(
            table.tenantAdminId,
            table.normalizedPhone,
        ),
        unique('pppoe_service_account_claim_code_hash_key').on(
            table.claimCodeHash,
        ),
        unique('pppoe_service_account_username_key').on(table.username),
        check(
            'pppoe_service_account_phone_e164_check',
            sql`${table.normalizedPhone} ~ '^[+][1-9][0-9]{7,14}$'`,
        ),
        index('pppoe_service_account_tenant_idx').on(table.tenantAdminId),
        index('pppoe_service_account_customer_idx').on(table.customerUserId),
    ],
);

export const pppoeServiceAccountsRelations = relations(
    pppoeServiceAccounts,
    ({ one }) => ({
        customer: one(user, {
            fields: [pppoeServiceAccounts.customerUserId],
            references: [user.id],
        }),
        tenantAdmin: one(adminUser, {
            fields: [pppoeServiceAccounts.tenantAdminId],
            references: [adminUser.id],
        }),
    }),
);
