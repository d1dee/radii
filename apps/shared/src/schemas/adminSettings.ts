// Per-admin console settings (apps/api GET/PUT /admin/settings, stored in the
// admin_setting table keyed by admin_user.id). These settings only ever affect
// the owning admin: display formatting for their console, dashboard/interface
// defaults, their own M-Pesa credentials for payments made through the NAS
// devices they own, and the support contacts shown to customers in the
// portals served by their NAS devices. When an admin has not configured
// M-Pesa credentials the server-wide (env) configuration is used instead.

import { z } from 'zod';

export const timeFormatSchema = z.enum(['12h', '24h']);
export type TimeFormat = z.infer<typeof timeFormatSchema>;

export const dateFormatSchema = z.enum([
    'D MMM YYYY',
    'DD/MM/YYYY',
    'MM/DD/YYYY',
    'YYYY-MM-DD',
]);
export type DateFormat = z.infer<typeof dateFormatSchema>;

export const adminAppearanceSettingsSchema = z.object({
    timeFormat: timeFormatSchema.default('24h'),
    dateFormat: dateFormatSchema.default('D MMM YYYY'),
    // IANA timezone used to render dates/times in the admin console.
    timezone: z.string().min(1).max(64).default('Africa/Nairobi'),
    // Currency label prefix used by money formatting (e.g. "Ksh").
    currencyLabel: z.string().min(1).max(12).default('Ksh'),
});

export const adminDashboardSettingsSchema = z.object({
    // Auto-refresh cadence (seconds) for all admin console data pages
    // (dashboard stats/reports, users, payments, sessions, packages, NAS).
    usageRefreshSeconds: z.number().int().min(10).max(600).default(60),
    // Default dashboard/reports date-range preset, in days.
    defaultRangeDays: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(30),
    // Default table page size for paginated admin lists.
    perPage: z
        .union([z.literal(10), z.literal(25), z.literal(50), z.literal(100)])
        .default(25),
});

export const mpesaTransactionTypeSchema = z.enum([
    'CustomerPayBillOnline',
    'CustomerBuyGoodsOnline',
]);
export type MpesaTransactionType = z.infer<typeof mpesaTransactionTypeSchema>;

export const adminMpesaSettingsSchema = z
    .object({
        // When false the server-wide M-Pesa configuration (env) is used for
        // this admin's payments; the fields below are ignored.
        useOwnCredentials: z.boolean().default(false),
        consumerKey: z.string().max(255).default(''),
        consumerSecret: z.string().max(255).default(''),
        // Safaricom shortcode: 5-7 digits (tills up to 7).
        shortcode: z.string().max(7).default(''),
        passkey: z.string().max(255).default(''),
        environment: z.enum(['sandbox', 'production']).default('production'),
        // Only needed for receipt verification (Transaction Status API); STK
        // push/query work without them.
        initiatorName: z.string().max(255).default(''),
        initiatorPassword: z.string().max(255).default(''),
        certificatePath: z.string().max(512).default(''),
        transactionType: mpesaTransactionTypeSchema.default(
            'CustomerPayBillOnline',
        ),
    })
    .superRefine((mpesa, ctx) => {
        if (!mpesa.useOwnCredentials) return;
        if (!/^\d{5,7}$/.test(mpesa.shortcode)) {
            ctx.addIssue({
                code: 'custom',
                path: ['shortcode'],
                message: 'shortcode must be a 5-7 digit Safaricom number',
            });
        }
        const required = [
            ['consumerKey', mpesa.consumerKey],
            ['consumerSecret', mpesa.consumerSecret],
            ['passkey', mpesa.passkey],
        ] as const;
        for (const [field, value] of required) {
            if (!value.trim()) {
                ctx.addIssue({
                    code: 'custom',
                    path: [field],
                    message: `${field} is required when using your own M-Pesa credentials`,
                });
            }
        }
    });

// Support contacts shown to customers in the hotspot/ppoe portals
// ("Call Admin" / "WhatsApp Admin" cards). Both numbers are international
// format; the WhatsApp number must start with '+' (E.164). Empty values hide
// the corresponding button in the portals.
export const adminContactsSettingsSchema = z
    .object({
        adminTel: z.string().max(32).default(''),
        adminWhatsapp: z.string().max(32).default(''),
    })
    .superRefine((contacts, ctx) => {
        if (contacts.adminTel && !/^\+?[0-9\s\-()]{7,20}$/.test(contacts.adminTel)) {
            ctx.addIssue({
                code: 'custom',
                path: ['adminTel'],
                message: 'Enter a valid phone number, e.g. +254712345678',
            });
        }
        if (contacts.adminWhatsapp && !/^\+[0-9]{9,15}$/.test(contacts.adminWhatsapp)) {
            ctx.addIssue({
                code: 'custom',
                path: ['adminWhatsapp'],
                message:
                    'Enter a WhatsApp number in international format starting with +, e.g. +254712345678',
            });
        }
    });

export type AdminContactsSettings = z.output<typeof adminContactsSettingsSchema>;

export const adminSettingsSchema = z.object({
    appearance: adminAppearanceSettingsSchema.prefault({}),
    dashboard: adminDashboardSettingsSchema.prefault({}),
    mpesa: adminMpesaSettingsSchema.prefault({}),
    contacts: adminContactsSettingsSchema.prefault({}),
});

export type AdminSettings = z.output<typeof adminSettingsSchema>;
// Partial input accepted by PUT /admin/settings; missing values fall back to
// the same defaults the server stores.
export type AdminSettingsInput = z.input<typeof adminSettingsSchema>;

export const defaultAdminSettings: AdminSettings = adminSettingsSchema.parse({});
