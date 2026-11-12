import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { emailOTP } from 'better-auth/plugins';
import { db } from './db';
import { agentAccount, agentSession, agentUser, agentVerification } from './db/schema/agent-portal';
import { env } from './env';
import { sendAgentOtpEmail } from './lib/email';

export const agentAuth = betterAuth({
    basePath: '/api/agents/auth', baseURL: env.apiUrl, secret: env.agentBetterAuthSecret,
    trustedOrigins: env.agentFrontendUrls,
    database: drizzleAdapter(db, { provider: 'pg', schema: { user: agentUser, session: agentSession, account: agentAccount, verification: agentVerification } }),
    emailAndPassword: { enabled: true, minPasswordLength: 12, maxPasswordLength: 128, requireEmailVerification: true, revokeSessionsOnPasswordReset: true },
    emailVerification: { sendOnSignUp: true, sendOnSignIn: true, autoSignInAfterVerification: false },
    session: { expiresIn: 86400, freshAge: 300, cookieCache: { enabled: false } },
    plugins: [emailOTP({ disableSignUp: true, overrideDefaultEmailVerification: true, sendVerificationOnSignUp: true,
        otpLength: 6, expiresIn: 300, allowedAttempts: 5, storeOTP: 'hashed',
        sendVerificationOTP: async input => { void sendAgentOtpEmail(input); },
    })],
    rateLimit: { enabled: true, customRules: { '/sign-in/email': { window: 60, max: 5 }, '/sign-up/email': { window: 60, max: 3 } } },
    advanced: { cookiePrefix: 'radii-agent' },
    hooks: { before: createAuthMiddleware(async ctx => {
        // Do not expose passwordless OTP sign-in or identity-changing/deletion
        // endpoints on a financial identity. Explicitly allow only this surface.
        const allowed = ['/sign-up/email', '/sign-in/email', '/sign-out', '/get-session', '/verify-password',
            '/change-password', '/list-sessions', '/revoke-session', '/revoke-other-sessions',
            '/email-otp/send-verification-otp', '/email-otp/verify-email', '/email-otp/request-password-reset', '/email-otp/reset-password'];
        if (!allowed.includes(ctx.path)) throw new APIError('NOT_FOUND', { message: 'Not found' });
        const body = (ctx.body ?? {}) as Record<string, unknown>;
        if (ctx.path === '/sign-up/email' && Object.keys(body).some(k => !['name', 'email', 'password', 'callbackURL', 'rememberMe'].includes(k))) {
            throw new APIError('BAD_REQUEST', { message: 'Registration cannot claim an agent record' });
        }
        if (ctx.path === '/email-otp/send-verification-otp' && body.type !== 'email-verification' && body.type !== 'forget-password') {
            throw new APIError('BAD_REQUEST', { message: 'Password sign-in is required' });
        }
    }) },
});
