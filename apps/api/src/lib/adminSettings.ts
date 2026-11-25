// Per-admin settings persistence and tenant resolution.
//
// Settings live in the admin_setting table (one row per admin_user) and are
// always served through adminSettingsSchema from @radii/shared, so stored
// documents from older versions gain new defaults on read. The M-Pesa
// provider cache keyed off these settings is invalidated here on save (see
// lib/payments/adminProviders.ts).

import {
    adminSettingsSchema,
    mergeAdminSettingsSecrets,
    type AdminSettings,
} from '@radii/shared';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { adminSetting, nasDevice, packagePayments } from '../db/schema';
import { invalidateAdminMpesaProvider } from './payments/adminProviders';

// Loads (and normalizes) the settings row for an admin. Missing rows simply
// yield the schema defaults; nothing is written until the admin saves.
export async function getAdminSettings(
    adminId: string,
    executor: Pick<typeof db, 'select'> = db,
): Promise<AdminSettings> {
    const [row] = await executor
        .select({ settings: adminSetting.settings })
        .from(adminSetting)
        .where(eq(adminSetting.adminUserId, adminId))
        .limit(1);
    const parsed = adminSettingsSchema.safeParse(row?.settings ?? {});
    return parsed.success ? parsed.data : adminSettingsSchema.parse({});
}

// Validates and upserts the full settings document, then drops any cached
// per-admin M-Pesa provider so the next payment uses the new credentials.
// Secret fields (consumerSecret/passkey/initiatorPassword) arrive masked or
// empty when the client round-trips the GET response; the stored values are
// merged back in before validation so credentials are never wiped by a save
// that did not intend to change them.
export async function saveAdminSettings(
    adminId: string,
    input: unknown,
    executor: Pick<typeof db, 'select' | 'insert'> = db,
): Promise<AdminSettings> {
    const existing = await getAdminSettings(adminId, executor);
    const settings = adminSettingsSchema.parse(
        mergeAdminSettingsSecrets(input, existing),
    );
    await executor
        .insert(adminSetting)
        // Bind serialized JSON as text so Bun SQL does not encode it twice.
        .values({
            adminUserId: adminId,
            settings: sql`${JSON.stringify(settings)}::text::jsonb`,
        })
        .onConflictDoUpdate({
            target: adminSetting.adminUserId,
            // WAHA is a private backend-only section, not part of the public
            // console settings schema. Preserve it atomically on normal saves.
            set: {
                settings: sql`${JSON.stringify(settings)}::text::jsonb || jsonb_build_object('whatsapp', coalesce((case when jsonb_typeof(${adminSetting.settings}) = 'string' then (${adminSetting.settings} #>> '{}')::jsonb else ${adminSetting.settings} end)->'whatsapp', '{}'::jsonb))`,
            },
        });
    invalidateAdminMpesaProvider(adminId);
    return settings;
}

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Owning admin of a NAS device — the tenant-attribution root used to pick the
// per-admin M-Pesa configuration for payments made through that device.
export async function getAdminIdForNasDevice(
    nasDeviceId: string | null | undefined,
): Promise<string | null> {
    if (!nasDeviceId || !UUID_RE.test(nasDeviceId)) return null;
    const [row] = await db
        .select({ ownerId: nasDevice.ownerId })
        .from(nasDevice)
        .where(eq(nasDevice.id, nasDeviceId))
        .limit(1);
    return row?.ownerId ?? null;
}

// Best-effort tenant attribution for flows without a NAS stamp (e.g. receipt
// verification): the most recent payment that identified a NAS device
// decides which admin's M-Pesa credentials verify the receipt. Null when the
// customer has no attributed payment — callers fall back to the global
// configuration.
export async function getAdminIdForUser(
    userId: string,
): Promise<string | null> {
    const candidates = await db
        .select({ nasDeviceId: packagePayments.nasDeviceId })
        .from(packagePayments)
        .where(eq(packagePayments.userId, userId))
        .orderBy(desc(packagePayments.createdAt))
        .limit(50);
    for (const candidate of candidates) {
        if (candidate.nasDeviceId) {
            const adminId = await getAdminIdForNasDevice(candidate.nasDeviceId);
            if (adminId) return adminId;
        }
    }
    return null;
}
