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
    'DD MMM YYYY',
    'DD/MM/YYYY',
    'MM/DD/YYYY',
    'YYYY-MM-DD',
]);
export type DateFormat = z.infer<typeof dateFormatSchema>;

export const adminAppearanceSettingsSchema = z.object({
    timeFormat: timeFormatSchema.default('24h'),
    dateFormat: dateFormatSchema.default('DD MMM YYYY'),
    // IANA timezone used to render dates/times in the admin console.
    timezone: z.string().trim().min(1).max(64).default('Africa/Nairobi'),
    // Currency label prefix used by money formatting (e.g. "Ksh").
    currencyLabel: z.string().trim().min(1).max(12).default('Ksh'),
});

export const adminDashboardSettingsSchema = z.object({
    // Auto-refresh cadence (seconds) for all admin console data pages
    // (dashboard stats/reports, users, payments, sessions, packages, NAS).
    usageRefreshSeconds: z.number().int().min(10).max(600).default(60),
    // Default dashboard/reports date-range preset, in days.
    defaultRangeDays: z
        .union([z.literal(7), z.literal(30), z.literal(90)])
        .default(30),
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
        consumerKey: z.string().trim().max(255).default(''),
        consumerSecret: z.string().max(255).default(''),
        // Organization shortcode used for API authentication and STK signing.
        shortcode: z.string().trim().max(7).default(''),
        // Buy Goods destination. PayBill payments use shortcode as PartyB.
        tillNumber: z.string().trim().max(7).default(''),
        passkey: z.string().max(255).default(''),
        environment: z.enum(['sandbox', 'production']).default('production'),
        // Only needed for receipt verification (Transaction Status API); STK
        // push/query work without them.
        initiatorName: z.string().trim().max(255).default(''),
        initiatorPassword: z.string().max(255).default(''),
        // Path to the certificate used to encrypt the initiator password.
        // Server-enforced: must resolve to a file inside the API's
        // MPESA_ALLOWED_CERT_DIR (default <api cwd>/certs); paths outside it
        // (including symlink escapes) are rejected. Empty = the Safaricom
        // certificate bundled with the provider for the selected environment.
        certificatePath: z.string().trim().max(512).default(''),
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
        if (
            mpesa.transactionType === 'CustomerBuyGoodsOnline' &&
            !/^\d{5,7}$/.test(mpesa.tillNumber)
        ) {
            ctx.addIssue({
                code: 'custom',
                path: ['tillNumber'],
                message:
                    'tillNumber must be a 5-7 digit Safaricom number for Buy Goods payments',
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
        adminTel: z.string().trim().max(32).default(''),
        adminWhatsapp: z.string().trim().max(32).default(''),
    })
    .superRefine((contacts, ctx) => {
        if (
            contacts.adminTel &&
            !/^\+?[0-9\s\-()]{7,20}$/.test(contacts.adminTel)
        ) {
            ctx.addIssue({
                code: 'custom',
                path: ['adminTel'],
                message: 'Enter a valid phone number, e.g. +254712345678',
            });
        }
        if (
            contacts.adminWhatsapp &&
            !/^\+[0-9]{9,15}$/.test(contacts.adminWhatsapp)
        ) {
            ctx.addIssue({
                code: 'custom',
                path: ['adminWhatsapp'],
                message:
                    'Enter a WhatsApp number in international format starting with +, e.g. +254712345678',
            });
        }
    });

export type AdminContactsSettings = z.output<
    typeof adminContactsSettingsSchema
>;

// Package behaviour defaults for the owning admin's tenant. A null/absent
// noExpiryValidityMonths means "use the server default" (env
// NO_EXPIRY_VALIDITY_MONTHS); it bounds how long a hotspot cumulative
// time-bank (noExpiry) package stays usable after activation.
export const adminPackagesSettingsSchema = z.object({
    noExpiryValidityMonths: z.number().int().min(1).max(120).nullish(),
    pppoeConnectionFeeAmount: z.number().int().min(0).max(99999999).default(0),
});

export const adminPppoeSettingsSchema = z.object({
    // Customer portal password self-service is opt-in because PPPoE
    // credentials grant direct network access.
    showPasswordsInPortal: z.boolean().default(false),
});

export const pppoeExpiryReminderPlaceholders = [
    'customer_name',
    'username',
    'package_name',
    'expiry_date',
    'expiry_time',
    'amount',
    'support_phone',
] as const;

export type PppoeExpiryReminderValues = Record<
    (typeof pppoeExpiryReminderPlaceholders)[number],
    string
>;

export const defaultPppoeExpiryReminderTemplate =
    'Hello {{customer_name}}, your {{package_name}} subscription for {{username}} expires on {{expiry_date}} at {{expiry_time}}. Please renew for {{amount}} to stay connected. For assistance, contact {{support_phone}}.';

export const pppoeExpiryReminderTemplateSchema = z
    .string()
    .trim()
    .min(1, 'Enter a reminder message.')
    .max(4096, 'Reminder messages must be 4096 characters or fewer.')
    .superRefine((template, ctx) => {
        const remaining = template.replace(
            /\{\{\s*([a-z_]+)\s*\}\}/g,
            (token, name: string) => {
                if (!(pppoeExpiryReminderPlaceholders as readonly string[]).includes(name)) {
                    ctx.addIssue({
                        code: 'custom',
                        message: `Unsupported placeholder ${token}. Use one of the listed placeholders.`,
                    });
                }
                return '';
            },
        );
        if (/[{}]/.test(remaining)) {
            ctx.addIssue({
                code: 'custom',
                message: 'Use placeholders in the form {{customer_name}}; unmatched braces are not supported.',
            });
        }
    });

// Replace only template tokens, never tokens occurring in customer data.
export function renderPppoeExpiryReminderTemplate(
    template: string,
    values: PppoeExpiryReminderValues,
): string {
    return pppoeExpiryReminderTemplateSchema.parse(template).replace(
        /\{\{\s*([a-z_]+)\s*\}\}/g,
        (_token, name: keyof PppoeExpiryReminderValues) => values[name],
    );
}

// The API reminder worker consumes these per-admin settings every minute.
export const pppoeExpiryReminderScheduleSchema = z.object({
    enabled: z.boolean().default(false),
    timingMode: z.enum(['hours', 'percentage']).default('hours'),
    remainingPercentage: z
        .number()
        .int('Enter a whole percentage.')
        .min(1, 'Enter at least 1% time remaining.')
        .max(99, 'Enter no more than 99% time remaining.')
        .default(10),
    leadTimeHours: z
        .number()
        .int('Enter a whole number of hours.')
        .min(1, 'Enter at least 1 hour before expiry.')
        .max(720, 'Enter no more than 720 hours (30 days) before expiry.')
        .default(24),
});

export const adminMessagingSettingsSchema = z.object({
    pppoeExpiryReminderSchedule: pppoeExpiryReminderScheduleSchema.prefault({}),
    pppoeExpiryReminderTemplate: pppoeExpiryReminderTemplateSchema.default(
        defaultPppoeExpiryReminderTemplate,
    ),
});

export const adminSettingsSchema = z.object({
    appearance: adminAppearanceSettingsSchema.prefault({}),
    dashboard: adminDashboardSettingsSchema.prefault({}),
    mpesa: adminMpesaSettingsSchema.prefault({}),
    contacts: adminContactsSettingsSchema.prefault({}),
    packages: adminPackagesSettingsSchema.prefault({}),
    pppoe: adminPppoeSettingsSchema.prefault({}),
    messaging: adminMessagingSettingsSchema.prefault({}),
});

export type AdminSettings = z.output<typeof adminSettingsSchema>;
// Partial input accepted by PUT /admin/settings; missing values fall back to
// the same defaults the server stores.
export type AdminSettingsInput = z.input<typeof adminSettingsSchema>;

export const defaultAdminSettings: AdminSettings = adminSettingsSchema.parse(
    {},
);

// --- Write-only M-Pesa secrets -------------------------------------------------
// HTTP responses never return the stored secret values. GET/PUT
// /admin/settings replace a configured secret with ADMIN_SECRET_MASK (and an
// empty string when unset) plus companion `<field>Set` booleans so the UI can
// show the "configured" state. On PUT the mask (or an empty value) means
// "keep the stored secret"; any other non-empty value overwrites it. Internal
// server consumers (payments provider, RADIUS) keep reading the real values
// through getAdminSettings — masking only applies to serialized responses.

export const ADMIN_SECRET_MASK = '__MASKED__';

export const adminMpesaSecretFields = [
    'consumerSecret',
    'passkey',
    'initiatorPassword',
] as const;
export type AdminMpesaSecretField = (typeof adminMpesaSecretFields)[number];

// Shape of the settings document as returned by the admin settings API:
// AdminSettings with masked mpesa secrets and `<field>Set` booleans.
export type AdminSettingsResponse = Omit<AdminSettings, 'mpesa'> & {
    mpesa: AdminSettings['mpesa'] & {
        consumerSecretSet: boolean;
        passkeySet: boolean;
        initiatorPasswordSet: boolean;
    };
};

export function maskAdminSettings(
    settings: AdminSettings,
): AdminSettingsResponse {
    return {
        ...settings,
        mpesa: {
            ...settings.mpesa,
            consumerSecret: settings.mpesa.consumerSecret
                ? ADMIN_SECRET_MASK
                : '',
            passkey: settings.mpesa.passkey ? ADMIN_SECRET_MASK : '',
            initiatorPassword: settings.mpesa.initiatorPassword
                ? ADMIN_SECRET_MASK
                : '',
            consumerSecretSet: settings.mpesa.consumerSecret !== '',
            passkeySet: settings.mpesa.passkey !== '',
            initiatorPasswordSet: settings.mpesa.initiatorPassword !== '',
        },
    };
}

// Substitutes the stored secrets back into a raw PUT payload so a round-trip
// of the masked GET response never wipes real credentials. Runs before
// adminSettingsSchema.parse so validation sees the effective values.
export function mergeAdminSettingsSecrets(
    input: unknown,
    existing: AdminSettings,
): unknown {
    if (typeof input !== 'object' || input === null) return input;
    const raw = input as Record<string, unknown>;
    if (typeof raw.mpesa !== 'object' || raw.mpesa === null) return input;
    const mpesa = { ...(raw.mpesa as Record<string, unknown>) };
    for (const field of adminMpesaSecretFields) {
        const value = mpesa[field];
        if (
            value === undefined ||
            value === '' ||
            value === ADMIN_SECRET_MASK
        ) {
            mpesa[field] = existing.mpesa[field];
        }
    }
    return { ...raw, mpesa };
}
