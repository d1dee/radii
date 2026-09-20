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
            return new Response(file);
        }

        // SPA fallback
        return new Response(Bun.file('dist/index.html'));
    },
});

logger.info('Admin server started', { url: server.url.toString() });
