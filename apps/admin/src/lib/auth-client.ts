import { adminClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

const baseURL = import.meta.env.VITE_AUTH_BASEURL;

if (!baseURL) {
    throw new Error('VITE_AUTH_BASEURL environment variable is not defined');
}

export const authClient = createAuthClient({
    baseURL,
    fetchOptions: {
        credentials: 'include',
    },
    plugins: [adminClient()],
});
