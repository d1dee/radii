import { eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { adminSetting } from '../db/schema';
import { env } from '../env';
import { createWahaClient } from './waha';
import { createWahaSettingsService } from './wahaSettings';

// Older Bun SQL writes could persist the document as a JSON string.
const settingsDocument = sql`(case when jsonb_typeof(${adminSetting.settings}) = 'string' then (${adminSetting.settings} #>> '{}')::jsonb else ${adminSetting.settings} end)`;

export const adminWhatsAppSettings = createWahaSettingsService(
    {
        async read(adminId) {
            const [row] = await db
                .select({
                    config: sql`${settingsDocument}->'whatsapp'`.mapWith(
                        adminSetting.settings,
                    ),
                })
                .from(adminSetting)
                .where(eq(adminSetting.adminUserId, adminId))
                .limit(1);
            return row?.config;
        },
        async update(adminId, change) {
            return db.transaction(async (tx) => {
                await tx
                    .insert(adminSetting)
                    .values({ adminUserId: adminId })
                    .onConflictDoNothing();
                const [row] = await tx
                    .select({
                        config: sql`${settingsDocument}->'whatsapp'`.mapWith(
                            adminSetting.settings,
                        ),
                    })
                    .from(adminSetting)
                    .where(eq(adminSetting.adminUserId, adminId))
                    .for('update');
                const config = change(row?.config);
                await tx
                    .update(adminSetting)
                    .set({
                        // Bind serialized JSON as text so Bun SQL does not encode it twice.
                        settings: sql`jsonb_set(${settingsDocument}, '{whatsapp}', ${JSON.stringify(config)}::text::jsonb)`,
                    })
                    .where(eq(adminSetting.adminUserId, adminId));
                return config;
            });
        },
    },
    env.waha,
    env.wahaSettingsEncryptionKey,
);

export const adminWhatsApp = createWahaClient((adminId) =>
    adminWhatsAppSettings.resolve(adminId),
);

// Internal callers must supply the owning admin's trusted server-side ID.
export function sendAdminWhatsAppText(
    adminId: string,
    phone: string,
    text: string,
): Promise<{ ok: true }> {
    return adminWhatsApp.sendText(adminId, phone, text);
}
