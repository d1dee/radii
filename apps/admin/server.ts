import {
    configureSync,
    getConsoleSink,
    getLogger,
} from '@logtape/logtape';
import { join } from 'path';

configureSync({
    sinks: { console: getConsoleSink() },
    loggers: [
        {
            category: ['radii', 'admin', 'server'],
            lowestLevel: 'info',
            sinks: ['console'],
        },
        {
            category: ['logtape', 'meta'],
            lowestLevel: 'warning',
            sinks: ['console'],
        },
    ],
});

const logger = getLogger(['radii', 'admin', 'server']);
const PORT = parseInt(Bun.env.SERVER_PORT || '0');
const SERVER_ADDRESS = Bun.env.SERVER_ADDRESS;
const IMMUTABLE_ASSET_CACHE = 'public, max-age=31536000, immutable';
const REVALIDATE_CACHE = 'no-cache';

if (!SERVER_ADDRESS) {
    logger.fatal('SERVER_ADDRESS is not configured');
    process.exit('SERVER_ADDRESS_ERROR');
}

const server = Bun.serve({
    port: PORT,
    hostname: SERVER_ADDRESS,
    async fetch(req) {
        const url = new URL(req.url);

        // Static files
        let path = join('dist', url.pathname);

        let file = Bun.file(path);

        if (await file.exists()) {
            return new Response(file, {
                headers: {
                    'Cache-Control': url.pathname.startsWith('/assets/')
                        ? IMMUTABLE_ASSET_CACHE
                        : REVALIDATE_CACHE,
                },
            });
        }

        // SPA fallback
        return new Response(Bun.file('dist/index.html'), {
            headers: { 'Cache-Control': REVALIDATE_CACHE },
        });
    },
});

logger.info('Admin server started', { url: server.url.toString() });
