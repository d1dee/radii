import { relations } from 'drizzle-orm';
import {
    boolean,
    index,
    inet,
    jsonb,
    pgTable,
    text,
    timestamp,
    unique,
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
        // Nullable: auto-detected from the device when its setup script runs.
        model: text('model'),
        serialNumber: text('serial_number').unique(),
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

// Rendered (device-specific) NAS setup script, generated from a template that
// is substituted with this device's IP, RADIUS secret, WireGuard keys, etc.
// One row per NAS device; regenerating overwrites it.
//
// This table is the single source of truth for the WireGuard peering state:
// key material lives in dedicated columns and the rendered script column is
// the final config. The server reconciles the live WireGuard interface from
// these rows (on device report and at startup); peers unknown to this table
// are pruned from the interface.
export const nasSetupScript = pgTable(
    'nas_setup_script',
    {
        id: text('id').primaryKey(),
        nasDeviceId: text('nas_device_id')
            .notNull()
            .references(() => nasDevice.id, { onDelete: 'cascade' }),
        // The fully rendered RouterOS script, ready to paste/import — the
        // final config for the device.
        script: text('script').notNull(),
        // WireGuard public key reported by the device when the script runs.
        // Null until the report arrives; reset to null on regeneration
        // (the device generates a fresh keypair when re-running the script).
        wgPublicKey: text('wg_public_key'),
        // Tunnel address allocated to the device from the management subnet;
        // the server reaches the NAS over it once the tunnel is up.
        wgClientIp: inet('wg_client_ip').notNull(),
        // WireGuard preshared key shared with the device.
        wgPsk: text('wg_psk').notNull(),
        // RADIUS shared secret registered in the FreeRADIUS `nas` table.
        radiusSecret: text('radius_secret').notNull(),
        // One-shot token embedded in the script, required by the device
        // report endpoint.
        registrationToken: text('registration_token').notNull(),
        // When the device reported its WireGuard key.
        wgKeyReportedAt: timestamp('wg_key_reported_at', {
            withTimezone: true,
            mode: 'date',
        }),
        // pending: generated, waiting for the device report.
        // applied: device reported and the server-side WireGuard peer is in
        //          place.
        // failed:  device reported but applying the server-side peer failed;
        //          startup reconciliation repairs these rows.
        status: text('status', {
            enum: ['pending', 'applied', 'failed'],
        })
            .default('pending')
            .notNull(),
        generatedAt: timestamp('generated_at', {
            withTimezone: true,
            mode: 'date',
        })
            .defaultNow()
            .notNull(),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
            .defaultNow()
            .notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (table) => [
        unique('nas_setup_script_nas_device_id_key').on(table.nasDeviceId),
        index('nas_setup_script_status_idx').on(table.status),
    ],
);

export const nasSetupScriptRelations = relations(nasSetupScript, ({ one }) => ({
    nasDevice: one(nasDevice, {
        fields: [nasSetupScript.nasDeviceId],
        references: [nasDevice.id],
    }),
}));
