import { relations } from 'drizzle-orm';
import {
    index,
    inet,
    jsonb,
    pgTable,
    primaryKey,
    text,
    timestamp,
    unique,
    uuid,
    varchar,
} from 'drizzle-orm/pg-core';
import { user } from './auth-schema';
import { packages } from './packages';

export const nasDevice = pgTable(
    'nas_device',
    {
        id: uuid('id').primaryKey(),
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

// Many-to-many link between packages and NAS devices. A package with no rows
// here is available on all NAS devices.
export const packageNasDevice = pgTable(
    'package_nas_device',
    {
        packageId: uuid('package_id')
            .notNull()
            .references(() => packages.id, { onDelete: 'cascade' }),
        nasDeviceId: uuid('nas_device_id')
            .notNull()
            .references(() => nasDevice.id, { onDelete: 'cascade' }),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
            .defaultNow()
            .notNull(),
    },
    (table) => [
        primaryKey({ columns: [table.packageId, table.nasDeviceId] }),
        index('package_nas_device_nas_device_id_idx').on(table.nasDeviceId),
    ],
);

export const packageNasDeviceRelations = relations(
    packageNasDevice,
    ({ one }) => ({
        package: one(packages, {
            fields: [packageNasDevice.packageId],
            references: [packages.id],
        }),
        nasDevice: one(nasDevice, {
            fields: [packageNasDevice.nasDeviceId],
            references: [nasDevice.id],
        }),
    }),
);

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
        id: uuid('id').defaultRandom().primaryKey(),
        nasDeviceId: uuid('nas_device_id')
            .notNull()
            .references(() => nasDevice.id, { onDelete: 'cascade' }),
        // The fully rendered RouterOS script, ready to paste/import — the
        // final config for the device.
        script: text('script').notNull(),
        // Hotspot HTML pages served to the router via /api/nas/:id/hotspot/:page
        // so the setup script can download them with /tool fetch instead of
        // embedding large strings inline.
        hotspotPages: jsonb('hotspot_pages').$type<Record<string, string>>(),
        // Hotspot options used to render the script; persisted so the admin
        // UI can prefill the generation form on regeneration. Nullable only
        // for rows generated before the columns existed.
        hotspotInterface: text('hotspot_interface'),
        hotspotNetwork: text('hotspot_network'),
        hotspotDnsName: text('hotspot_dns_name'),
        brandName: text('brand_name'),
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

// External captive-portal login request. When an unauthenticated client hits
// a NAS hotspot, the branded login page auto-submits every variable the RouterOS servlet exposes at login
export const hotspotLoginRequest = pgTable(
    'hotspot_login_request',
    {
        id: uuid('id').defaultRandom().primaryKey(),
        nasDeviceId: uuid('nas_device_id')
            .notNull()
            .references(() => nasDevice.id, { onDelete: 'cascade' }),
        // Client identity as reported by the NAS hotspot servlet.
        mac: text('mac').notNull(),
        ip: inet('ip'),
        // Username the client typed on the NAS login page, if any.
        username: text('username'),
        linkLogin: text('link_login'),
        linkLoginOnly: text('link_login_only'),
        // the destination the client originally requested.
        linkOrig: text('link_orig'),
        // Error message carried over from a previous failed login attempt.
        error: text('error'),
        // Everything else the NAS login page reports (hostname,
        // server-address, interface, trial, ...).
        extra: jsonb('extra').$type<Record<string, string>>(),
        status: text('status', { enum: ['pending', 'completed'] })
            .default('pending')
            .notNull(),
        // Portal user who completed the request.
        userId: text('user_id').references(() => user.id, {
            onDelete: 'set null',
        }),
        // Hotspot username issued to the NAS on completion (the matching
        // Cleartext-Password lives in radcheck).
        hotspotUsername: text('hotspot_username'),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
            .defaultNow()
            .notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (table) => [
        index('hotspot_login_request_nas_device_id_idx').on(table.nasDeviceId),
        index('hotspot_login_request_mac_idx').on(table.mac),
        index('hotspot_login_request_status_idx').on(table.status),
    ],
);

export const hotspotLoginRequestRelations = relations(
    hotspotLoginRequest,
    ({ one }) => ({
        nasDevice: one(nasDevice, {
            fields: [hotspotLoginRequest.nasDeviceId],
            references: [nasDevice.id],
        }),
        user: one(user, {
            fields: [hotspotLoginRequest.userId],
            references: [user.id],
        }),
    }),
);
