import { usernameClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

// The Vite dev server proxies `/api` to the Bun+Hono backend, so the auth
// server is effectively same-origin. The default base path is `/api/auth`,
// which means requests resolve to `/api/auth/*` and flow through the proxy.
export const authClient = createAuthClient({
    baseURL: import.meta.env.VITE_API_URL,
    basePath: '/api/auth/',
    plugins: [usernameClient()],
    sessionOptions: {
        refetchInterval: 10,
    },
});

export const { useSession } = authClient;
