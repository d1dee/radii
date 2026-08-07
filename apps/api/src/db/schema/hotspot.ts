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
} from 'drizzle-orm/pg-core';
import { user } from './auth-schema';
import { transaction } from './payments';
import { radacct } from './radius';

export const hotspotPackages = pgTable(
    'hotspot_packages',
    {
        id: text('id').primaryKey(),
        title: text('title').notNull(),
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
        gatewayId: text('gateway_id'),
        isActive: boolean('is_active').default(true).notNull(),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
            .defaultNow()
            .notNull(),
    },
    (table) => [
        index('hotspot_packages_category_idx').on(table.category),
        index('hotspot_packages_gateway_id_idx').on(table.gatewayId),
    ],
);

export const hotspotPayments = pgTable(
    'hotspot_payments',
    {
        id: text('id').primaryKey(),
        userId: text('user_id')
            .notNull()
            .references(() => user.id, { onDelete: 'cascade' }),
        packageId: text('package_id')
            .notNull()
            .references(() => hotspotPackages.id, { onDelete: 'restrict' }),
        status: text('status', { enum: ['pending', 'paid', 'failed'] })
            .notNull()
            .default('pending'),
        amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
        phoneNumber: text('phone_number').notNull(),
        transaction: text('transaction').references(() => transaction.id, {
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
        index('hotspot_payments_user_id_idx').on(table.userId),
        index('hotspot_payments_package_id_idx').on(table.packageId),
    ],
);

export const hotspotPaymentsRelations = relations(
    hotspotPayments,
    ({ one }) => ({
        user: one(user, {
            fields: [hotspotPayments.userId],
            references: [user.id],
        }),
        package: one(hotspotPackages, {
            fields: [hotspotPayments.packageId],
            references: [hotspotPackages.id],
        }),
        transaction: one(transaction, {
            fields: [hotspotPayments.transaction],
            references: [transaction.id],
        }),
    }),
);

export const activatedHotspot = pgTable(
    'hotspot_payment_radacct',
    {
        id: text('id').primaryKey(),
        hotspotPaymentId: text('hotspot_payment_id')
            .notNull()
            .references(() => hotspotPayments.id, { onDelete: 'cascade' }),
        radacctId: bigserial('radacct_id', { mode: 'bigint' })
            .notNull()
            .references(() => radacct.radacctid, { onDelete: 'restrict' }),
        userId: text('user_id')
            .notNull()
            .references(() => user.id, { onDelete: 'cascade' }),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
            .defaultNow()
            .notNull(),
        packageId: text('package_id')
            .notNull()
            .references(() => hotspotPackages.id, { onDelete: 'restrict' }),
        expireAt: timestamp('expires_at', {
            withTimezone: true,
            mode: 'date',
        }).notNull(),
    },
    (table) => [
        index('hotspot_payment_radacct_payment_id_idx').on(
            table.hotspotPaymentId,
        ),
        index('hotspot_payment_radacct_radacct_id_idx').on(table.radacctId),
        index('hotspot_payment_radacct_user_id_idx').on(table.userId),
    ],
);

export const activateHotspotRelation = relations(
    activatedHotspot,
    ({ one }) => ({
        hotspotPayment: one(hotspotPayments, {
            fields: [activatedHotspot.hotspotPaymentId],
            references: [hotspotPayments.id],
        }),
        package: one(hotspotPackages, {
            fields: [activatedHotspot.packageId],
            references: [hotspotPackages.id],
        }),
        radacct: one(radacct, {
            fields: [activatedHotspot.radacctId],
            references: [radacct.radacctid],
        }),
        user: one(user, {
            fields: [activatedHotspot.userId],
            references: [user.id],
        }),
    }),
);
