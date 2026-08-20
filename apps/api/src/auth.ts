import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import { admin, username } from 'better-auth/plugins';
import {
    isValidPhoneNumber,
    parsePhoneNumberFromString,
} from 'libphonenumber-js';
import { db } from './db';
import * as schema from './db/schema/auth-schema';

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
    ],
    secret: process.env.BETTER_AUTH_SECRET || 'change-me-in-production',
    baseURL:
        process.env.BASE_URL ||
        process.env.BETTER_AUTH_URL ||
        'http://localhost:3000',
    advanced: {
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
