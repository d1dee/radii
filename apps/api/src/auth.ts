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
import { sendPortalOtpSms } from './lib/sms';

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
        // registration; delivery converts it back to an SMS (lib/sms.ts).
        // OTPs are stored in plain text so admins can surface a pending code
        // on the customer detail view until the SMS provider is integrated.
        emailOTP({
            otpLength: 6,
            expiresIn: 300,
            allowedAttempts: 5,
            // Never create accounts through OTP sign-in portals.
            disableSignUp: true,
            sendVerificationOTP: async ({ email, otp, type }) => {
                void sendPortalOtpSms({ email, otp, type });
            },
        }),
    ],
    secret: process.env.BETTER_AUTH_SECRET || 'change-me-in-production',
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
