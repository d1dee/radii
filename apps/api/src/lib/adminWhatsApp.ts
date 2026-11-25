import { env } from '../env';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { adminSetting } from '../db/schema';
import { createWahaClient } from './waha';
import { createWahaSettingsService } from './wahaSettings';

export const adminWhatsAppSettings = createWahaSettingsService({
    async read(adminId) {
        const [row] = await db.select({ config: sql<unknown>`${adminSetting.settings}->'whatsapp'` })
            .from(adminSetting).where(eq(adminSetting.adminUserId, adminId)).limit(1);
        return row?.config;
    },
    async update(adminId, change) {
        return db.transaction(async (tx) => {
            await tx.insert(adminSetting).values({ adminUserId: adminId }).onConflictDoNothing();
            const [row] = await tx.select({ config: sql<unknown>`${adminSetting.settings}->'whatsapp'` })
                .from(adminSetting).where(eq(adminSetting.adminUserId, adminId)).for('update');
            const config = change(row?.config);
            await tx.update(adminSetting).set({
                settings: sql`jsonb_set(${adminSetting.settings}, '{whatsapp}', ${JSON.stringify(config)}::jsonb)`,
            }).where(eq(adminSetting.adminUserId, adminId));
            return config;
        });
    },
}, env.waha, env.wahaSettingsEncryptionKey);

export const adminWhatsApp = createWahaClient((adminId) => adminWhatsAppSettings.resolve(adminId));

// Internal callers must supply the owning admin's trusted server-side ID.
// This shares validation, readiness checks and send limits with the HTTP API.
export function sendAdminWhatsAppText(adminId: string, phone: string, text: string): Promise<{ ok: true }> {
    return adminWhatsApp.sendText(adminId, phone, text);
}
