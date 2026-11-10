import type { PackageAudienceConditions } from '@radii/shared';
import { index, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { adminUser } from './admin-auth-schema';
import { user } from './auth-schema';

export const packageAudiences = pgTable('package_audience', {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerId: text('owner_id').notNull().references(() => adminUser.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    conditions: jsonb('conditions').$type<PackageAudienceConditions>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().$onUpdate(() => new Date()).notNull(),
}, (table) => [index('package_audience_owner_idx').on(table.ownerId), unique('package_audience_owner_name_key').on(table.ownerId, table.name)]);

// Segmentation tags are separate from the existing CRM name/location record.
export const customerTags = pgTable('customer_tag', {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerId: text('owner_id').notNull().references(() => adminUser.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    tag: text('tag').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [unique('customer_tag_owner_user_tag_key').on(table.ownerId, table.userId, table.tag)]);
