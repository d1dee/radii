const PORT = parseInt(Bun.env.PORT || '9092');
const HOSTNAME = Bun.env.HOSTNAME;

import { join } from 'path';

const server = Bun.serve({
    port: PORT,
    hostname: HOSTNAME,
    async fetch(req) {
        const url = new URL(req.url);

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
