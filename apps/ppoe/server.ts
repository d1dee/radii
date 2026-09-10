const PORT = parseInt(Bun.env.PORT || '9092');
const SERVER_ADDRESS = Bun.env.SERVER_ADDRESS;

if (!SERVER_ADDRESS) {
    console.error('SERVER_ADDRESS not specified');
    process.exit('SERVER_ADDRESS_ERROR');
}

import { join } from 'path';

const server = Bun.serve({
    port: PORT,
    hostname: SERVER_ADDRESS,
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
