import { relations } from 'drizzle-orm';
import {
    boolean,
    index,
    inet,
    jsonb,
    pgTable,
    text,
    timestamp,
    varchar,
} from 'drizzle-orm/pg-core';
import { user } from './auth-schema';

export const nasDevice = pgTable(
    'nas_device',
    {
        id: text('id').primaryKey(),
        name: text('name').notNull(),
        ipAddress: inet('ip_address').notNull(),
        macAddress: varchar('mac_address', { length: 17 }),
        model: text('model').notNull(),
        serialNumber: text('serial_number').notNull().unique(),
        firmwareVersion: text('firmware_version'),
        location: text('location'),
        ownerId: text('owner_id')
            .notNull()
            .references(() => user.id, { onDelete: 'restrict' }),
        status: text('status', {
            enum: ['active', 'inactive', 'maintenance', 'offline'],
        })
            .default('active')
            .notNull(),
        metadata: jsonb('metadata'),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
            .defaultNow()
            .notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (table) => [
        index('nas_device_ip_address_idx').using(
            'btree',
            table.ipAddress.asc().nullsLast().op('inet_ops'),
        ),
        index('nas_device_owner_id_idx').on(table.ownerId),
        index('nas_device_status_idx').on(table.status),
        index('nas_device_serial_number_idx').on(table.serialNumber),
    ],
);

export const nasDeviceRelations = relations(nasDevice, ({ one }) => ({
    owner: one(user, {
        fields: [nasDevice.ownerId],
        references: [user.id],
    }),
}));

export const nasConfig = pgTable(
    'nas_config',
    {
        id: text('id').primaryKey(),
        nasDeviceId: text('nas_device_id')
            .notNull()
            .references(() => nasDevice.id, { onDelete: 'cascade' }),
        connectionType: text('connection_type', {
            enum: ['wireguard', 'direct', 'ovpn'],
        }).notNull(),
        name: text('name').notNull(),
        isEnabled: boolean('is_enabled').default(true).notNull(),
        config: jsonb('config').notNull(),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
            .defaultNow()
            .notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (table) => [
        index('nas_config_nas_device_id_idx').on(table.nasDeviceId),
        index('nas_config_type_idx').on(table.connectionType),
    ],
);

export const integrationConfigRelations = relations(nasConfig, ({ one }) => ({
    nasDevice: one(nasDevice, {
        fields: [nasConfig.nasDeviceId],
        references: [nasDevice.id],
    }),
}));
