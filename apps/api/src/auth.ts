import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import { admin, emailOTP, username } from 'better-auth/plugins';
import {
    isValidPhoneNumber,
    parsePhoneNumberFromString,
} from 'libphonenumber-js';
import { db } from './db';
import * as schema from './db/schema/auth-schema';
import { env } from './env';
import { sendPortalOtpWhatsApp } from './lib/sms';
import { apiLogger } from './logging';

export const auth = betterAuth({
    database: drizzleAdapter(db, {
        provider: 'pg',
        schema,
    }),
    emailAndPassword: {
        enabled: true,
        // PIN is a 4-digit code, so we relax the minimum password length.
        minPasswordLength: 4,
        maxPasswordLength: 4,
        // A forgotten-PIN reset signs out every existing session so a
        // compromised device cannot keep the old session alive.
        revokeSessionsOnPasswordReset: true,
    },
    plugins: [
        username({
            // The "username" is a phone number. Accept any valid number
            // (validated in ITU-T E.164 form) rather than a single country.
            usernameValidator: (value) => safeIsValidPhone(value),
            // Normalize to canonical E.164 so equivalent numbers share one
            // stored value.
            usernameNormalization: (value) =>
                parsePhoneNumberFromString(value)?.format('E.164') ??
                value.trim(),
            minUsernameLength: 8,
        }),
        admin({
            defaultRole: 'user',
            adminRoles: ['admin'],
        }),
        // OTP channel for the phone+PIN forget-PIN flow. The "email" is the
        // synthetic per-phone address (`<digits>@hotspot.local`) created at
        // registration; delivery uses the owning admin's WhatsApp session.
        // Preserve OTP storage and the existing admin support code view.
        emailOTP({
            otpLength: 6,
            expiresIn: 300,
            allowedAttempts: 5,
            // Never create accounts through OTP sign-in portals.
            disableSignUp: true,
            sendVerificationOTP: async (input) => {
                // Do not expose customer existence through SQL/WAHA latency.
                // Handle even unexpected failures outside the delivery try/catch.
                void Promise.resolve().then(() => sendPortalOtpWhatsApp(input)).catch(() => {
                    try {
                        apiLogger.warn('Portal reset code background delivery failed');
                    } catch {
                        // A failing log sink must not create an unhandled rejection.
                    }
                });
            },
        }),
    ],
    // Per-IP HTTP rate limiting. better-auth only enables it in production by
    // default (dist/context/create-context.mjs: `enabled ?? isProduction`),
    // so enable it explicitly. The stock special rule for /sign-in* is
    // 3/10s; the credential sign-in paths guard a 4-digit PIN (10^4 space),
    // so hold them to a sustained 10/60s instead. Other paths keep the
    // defaults (the emailOTP plugin already limits its own routes to 3/60s).
    // Note: the portal REST routes call auth.api.* server-side and bypass
    // this limiter — they are protected by the per-account lockout in
    // lib/authHelpers.ts.
    rateLimit: {
        enabled: true,
        customRules: {
            '/sign-in/username': { window: 60, max: 10 },
            '/sign-in/email': { window: 60, max: 10 },
        },
    },
    secret: env.betterAuthSecret,
    baseURL: env.apiUrl,
    trustedOrigins: env.frontendUrls,

    advanced: {
        cookiePrefix: 'radii-client',
        crossSubDomainCookies: {
            enabled: true,
        },
    },
});

function safeIsValidPhone(value: string): boolean {
    try {
        return isValidPhoneNumber(value);
    } catch {
        return false;
    }
}
