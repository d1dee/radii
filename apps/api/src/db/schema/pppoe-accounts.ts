import { relations, sql } from 'drizzle-orm';
import {
    check,
    index,
    pgTable,
    text,
    timestamp,
    unique,
    uniqueIndex,
    uuid,
} from 'drizzle-orm/pg-core';
import { adminUser } from './admin-auth-schema';
import { user } from './auth-schema';
import { nasDevice } from './integrations';

export const pppoeServiceAccounts = pgTable(
    'pppoe_service_account',
    {
        id: uuid('id').defaultRandom().primaryKey(),
        customerUserId: text('customer_user_id')
            .references(() => user.id, { onDelete: 'set null' }),
        tenantAdminId: text('tenant_admin_id')
            .notNull()
            .references(() => adminUser.id, { onDelete: 'restrict' }),
        // The PPPoE instance (NAS/router) this account dials through. Assigned
        // by the admin at provisioning time, or bonded automatically the first
        // time the credentials produce an unclaimed session at RADIUS
        // authorize. Nullable only to keep legacy rows loadable; enforcement
        // treats NULL as "bond on first dial".
        nasDeviceId: uuid('nas_device_id').references(() => nasDevice.id, {
            onDelete: 'restrict',
        }),
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
        // Closed accounts are kept for history and can be reactivated, but
        // they must not occupy their (customer, NAS) / (NAS, phone) slots:
        // uniqueness is only enforced among active/suspended rows.
        uniqueIndex('pppoe_service_account_customer_nas_key')
            .on(table.customerUserId, table.nasDeviceId)
            .where(sql`${table.status} <> 'closed'`),
        uniqueIndex('pppoe_service_account_nas_phone_key')
            .on(table.nasDeviceId, table.normalizedPhone)
            .where(sql`${table.status} <> 'closed'`),
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
        index('pppoe_service_account_nas_idx').on(table.nasDeviceId),
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
        nas: one(nasDevice, {
            fields: [pppoeServiceAccounts.nasDeviceId],
            references: [nasDevice.id],
        }),
    }),
);
