import { relations } from 'drizzle-orm';
import {
    bigserial,
    boolean,
    index,
    integer,
    numeric,
    pgTable,
    text,
    timestamp,
    uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth-schema';
import { transaction } from './payments';
import { radacct } from './radius';

export const packages = pgTable(
    'packages',
    {
        id: uuid('id').defaultRandom().primaryKey(),
        title: text('title').notNull(),
        type: text('type', { enum: ['hotspot', 'pppoe'] })
            .default('hotspot')
            .notNull(),
        category: text('category').notNull(),
        sessionLength: integer('session_length').notNull(),
        price: numeric('price', { precision: 10, scale: 2 }).notNull(),
        maxDevices: integer('max_devices').notNull(),
        noExpiry: boolean('no_expiry').notNull(),
        description: text('description'),
        note: text('note'),
        uploadRate: integer('upload_rate').notNull(),
        downloadRate: integer('download_rate').notNull(),
        downloadQuota: integer('download_quota').notNull(),
        uploadQuota: integer('upload_quota').notNull(),
        isActive: boolean('is_active').default(true).notNull(),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
            .defaultNow()
            .notNull(),
    },
    (table) => [
        index('packages_type_idx').on(table.type),
        index('packages_category_idx').on(table.category),
    ],
);

export const packagePayments = pgTable(
    'package_payments',
    {
        id: uuid('id').defaultRandom().primaryKey(),
        userId: text('user_id')
            .notNull()
            .references(() => user.id, { onDelete: 'cascade' }),
        packageId: uuid('package_id')
            .notNull()
            .references(() => packages.id, { onDelete: 'restrict' }),
        status: text('status', { enum: ['pending', 'paid', 'failed'] })
            .notNull()
            .default('pending'),
        amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
        phoneNumber: text('phone_number').notNull(),
        transaction: uuid('transaction').references(() => transaction.id, {
            onDelete: 'cascade',
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
        index('package_payments_user_id_idx').on(table.userId),
        index('package_payments_package_id_idx').on(table.packageId),
    ],
);

export const packagePaymentsRelations = relations(
    packagePayments,
    ({ one }) => ({
        user: one(user, {
            fields: [packagePayments.userId],
            references: [user.id],
        }),
        package: one(packages, {
            fields: [packagePayments.packageId],
            references: [packages.id],
        }),
        transaction: one(transaction, {
            fields: [packagePayments.transaction],
            references: [transaction.id],
        }),
    }),
);

export const activatedPackages = pgTable(
    'activated_packages',
    {
        id: uuid('id').defaultRandom().primaryKey(),
        packagePaymentId: uuid('package_payment_id')
            .notNull()
            .references(() => packagePayments.id, { onDelete: 'cascade' }),
        radacctId: bigserial('radacct_id', { mode: 'bigint' })
            .notNull()
            .references(() => radacct.radacctid, { onDelete: 'restrict' }),
        userId: text('user_id')
            .notNull()
            .references(() => user.id, { onDelete: 'cascade' }),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
            .defaultNow()
            .notNull(),
        activatedAt: timestamp('activated_at', {
            withTimezone: true,
            mode: 'date',
        })
            .defaultNow()
            .notNull(),
        packageId: uuid('package_id')
            .notNull()
            .references(() => packages.id, { onDelete: 'restrict' }),
        expireAt: timestamp('expires_at', {
            withTimezone: true,
            mode: 'date',
        }).notNull(),
    },
    (table) => [
        index('activated_packages_payment_id_idx').on(table.packagePaymentId),
        index('activated_packages_radacct_id_idx').on(table.radacctId),
        index('activated_packages_user_id_idx').on(table.userId),
    ],
);

export const activatedPackagesRelations = relations(
    activatedPackages,
    ({ one }) => ({
        packagePayment: one(packagePayments, {
            fields: [activatedPackages.packagePaymentId],
            references: [packagePayments.id],
        }),
        package: one(packages, {
            fields: [activatedPackages.packageId],
            references: [packages.id],
        }),
        radacct: one(radacct, {
            fields: [activatedPackages.radacctId],
            references: [radacct.radacctid],
        }),
        user: one(user, {
            fields: [activatedPackages.userId],
            references: [user.id],
        }),
    }),
);
