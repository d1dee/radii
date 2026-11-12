import { createAuthClient } from 'better-auth/react';
import { emailOTPClient } from 'better-auth/client/plugins';

// Same-origin in development (Vite proxy) and production (trusted proxy).
// Never share the admin or customer auth client/session.
export const authClient = createAuthClient({
    basePath: '/api/agents/auth',
    plugins: [emailOTPClient()],
});
