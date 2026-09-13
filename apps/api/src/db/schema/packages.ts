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
    type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { user } from './auth-schema';
// Circular module reference (integrations.ts imports packages): the column
// below resolves nasDevice lazily via an AnyPgColumn callback.
import { adminUser } from './admin-auth-schema';
import { nasDevice } from './integrations';
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
        // Legacy/configurable validity retained for package records. Runtime
        // expiry packages use their persisted activation expiry; no-expiry
        // packages use a fixed six-month validity and a cumulative time bank.

        validityDays: integer('validity_days').default(30).notNull(),
        createdBy: text().references(() => adminUser.id),
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
        // The NAS device the purchase happened through, stamped at order time
        // (hotspot: from the login request; PPPoE: from the portal's ?nas=
        // scoping; fallback: the package's NAS links when they resolve to a
        // single owner). This column is the tenant-attribution root for
        // admin-scoped views: payment -> NAS -> owning admin. Null only when
        // no device could be identified.
        nasDeviceId: uuid('nas_device_id').references(
            (): AnyPgColumn => nasDevice.id,
            { onDelete: 'set null' },
        ),
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
        index('package_payments_nas_device_id_idx').on(table.nasDeviceId),
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
        nasDevice: one(nasDevice, {
            fields: [packagePayments.nasDeviceId],
            references: [nasDevice.id],
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
