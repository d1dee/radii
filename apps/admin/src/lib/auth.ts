import { adminClient, emailOTPClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

// The admin console talks exclusively to the dedicated admin BetterAuth
// instance, mounted at /api/admin/auth and backed by the isolated admin_*
// tables. It never shares sessions with the customer instance at /api/auth
// (phone+PIN portal accounts): separate tables, base path and cookie prefix.
//
// The Vite dev server proxies `/api` to the Bun+Hono backend, so the auth
// server is effectively same-origin and requests flow through the proxy.
export const authClient = createAuthClient({
    basePath: '/api/admin/auth',
    plugins: [adminClient(), emailOTPClient()],
    sessionOptions: {
        refetchInterval: 10,
    },
});

export const { useSession } = authClient;
