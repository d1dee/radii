const PORT = parseInt(Bun.env.SERVER_PORT || '0');
const SERVER_ADDRESS = Bun.env.SERVER_ADDRESS;
const SERVER_PUBLIC_URL = Bun.env.SERVER_PUBLIC_URL;

if (!SERVER_ADDRESS || !SERVER_PUBLIC_URL) {
    console.error('SERVER_ADDRESS and SERVER_PUBLIC_URL are required');
    process.exit('SERVER_CONFIG_ERROR');
}

const canonicalPortalUrl = new URL(SERVER_PUBLIC_URL);

import { join } from 'path';

const server = Bun.serve({
    port: PORT,
    hostname: SERVER_ADDRESS,
    async fetch(req) {
        const url = new URL(req.url);
        const requestHost = req.headers.get('host');

        if (
            requestHost?.toLowerCase() !==
            canonicalPortalUrl.host.toLowerCase()
        ) {
            const location = new URL(canonicalPortalUrl);
            location.pathname = url.pathname;
            location.search = url.search;
            location.hash = '';
            return new Response(null, {
                status: 302,
                headers: {
                    Location: location.toString(),
                    'Cache-Control': 'no-store',
                },
            });
        }

        // Static files
        let path = join('dist', url.pathname);

        let file = Bun.file(path);

        if (await file.exists()) {
            return new Response(file);
        }

        // SPA fallback
        return new Response(Bun.file('dist/index.html'));
    },
});

console.log(`PPoE serving at ${server.url}`);
