// Dedicated BetterAuth instance for the admin console.
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { validateAdminPassword } from '@radii/shared';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { admin, emailOTP } from 'better-auth/plugins';
import { db } from './db';
import {
    adminAccount,
    adminSession,
    adminUser,
    adminVerification,
} from './db/schema/admin-auth-schema';
import { env } from './env';
import { sendAdminOtpEmail } from './lib/email';

// Paths that must satisfy the shared admin password policy before better-auth processes the request.
const PASSWORD_GUARDED_PATHS = [
    '/sign-up/email',
    '/reset-password',
    '/update-password',
    '/email-otp/reset-password',
];

export const adminAuth = betterAuth({
    basePath: '/api/admin/auth',
    database: drizzleAdapter(db, {
        provider: 'pg',
        // The adapter sees better-auth's standard model names
        schema: {
            user: adminUser,
            session: adminSession,
            account: adminAccount,
            verification: adminVerification,
        },
    }),
    emailAndPassword: {
        enabled: true,
        minPasswordLength: 8,
        requireEmailVerification: true,
        // An email-OTP password reset signs out every other admin session.
        revokeSessionsOnPasswordReset: true,
    },
    emailVerification: {
        autoSignInAfterVerification: true,
        // Re-send an OTP automatically when an unverified admin attempts to
        // sign in with their password.
        sendOnSignIn: true,
    },
    plugins: [
        // Every account on this instance is an admin but requireAdmin keeps
        // checking the role so future granular roles (e.g. operator)
        admin({
            // Self-service admin sign-up stays; signups keep receiving the
            // 'admin' role that the requireAdmin middleware checks.
            defaultRole: 'admin',
            // Defense in depth: the plugin's management endpoints are GLOBAL
            // (any admin could manage any other tenant's admin, and
            // list-user-sessions even returns raw session tokens), while all
            // tenant-scoped management lives in the app's own REST routes.
            // The plugin gates every endpoint through hasPermission()
            // (dist/plugins/admin/has-permission.mjs), which first checks
            // `options.adminUserIds.includes(userId)` — `[]` denies that
            // bypass — then authorizes the caller's role against
            // `options.roles || defaultRoles` — `{}` leaves no role with any
            // permission, so every endpoint throws FORBIDDEN for every
            // account. `adminRoles` must be omitted here: the plugin
            // validates it against the `roles` keys at startup
            // (dist/plugins/admin/admin.mjs) and would throw. index.ts
            // additionally 404s /api/admin/auth/admin/* unless
            // ALLOW_ADMIN_PLUGIN_ROUTES is exactly 'true'.
            adminUserIds: [],
            roles: {},
        }),
        emailOTP({
            overrideDefaultEmailVerification: true,
            otpLength: 6,
            expiresIn: 300,
            allowedAttempts: 5,
            sendVerificationOTP: async ({ email, otp, type }) => {
                void sendAdminOtpEmail({ email, otp, type });
            },
        }),
    ],
    // Server-side enforcement of the admin password policy (min 8 characters,
    // at least 2 of: lowercase, uppercase, numbers, symbols) same rule client-side via @radii/shared.
    hooks: {
        before: createAuthMiddleware(async (ctx) => {
            if (!PASSWORD_GUARDED_PATHS.includes(ctx.path)) return;
            const body = (ctx.body ?? {}) as Record<string, unknown>;
            const password = body.password ?? body.newPassword;
            if (typeof password !== 'string') return;
            const problem = validateAdminPassword(password);
            if (problem) {
                throw new APIError('BAD_REQUEST', { message: problem });
            }
        }),
    },
    secret: env.adminBetterAuthSecret,
    baseURL: env.apiUrl,
    trustedOrigins: env.adminFrontendUrls,
    advanced: {
        cookiePrefix: 'radii-admin',
        crossSubDomainCookies: {
            enabled: true,
        },
    },
});
