import { ApiErrorType } from '@radii/shared';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { adminAuth } from './adminAuth';
import { auth } from './auth';
import { closeDb } from './db';
import { env } from './env';
import { reconcileWireGuardPeers } from './lib/wgReconcile';
import routes from './routes';
import type { AppVariables } from './types';

const app = new Hono<{ Variables: AppVariables }>();

if (!env.frontendUrls.length) {
    throw new Error('FRONTEND_URLS must contain at least one origin');
}

app.use(logger());

// CORS — applied to all API routes (auth + REST).
app.use(
    '/api/*',
    cors({
        origin: [...env.frontendUrls, ...env.adminFrontendUrls],
        allowHeaders: ['Content-Type', 'Authorization'],
        allowMethods: ['POST', 'GET', 'OPTIONS', 'PUT', 'DELETE'],
        exposeHeaders: ['Content-Length'],
        maxAge: 600,
        credentials: true,
    }),
);

// Session middleware: resolve BOTH better-auth sessions for every request
// and attach them (or nothing) to the context for downstream handlers.
app.use('*', async (c, next) => {
    const [session, adminSession] = await Promise.all([
        auth.api.getSession({ headers: c.req.raw.headers }),
        adminAuth.api.getSession({ headers: c.req.raw.headers }),
    ]);
    if (session) {
        c.set('user', session.user);
        c.set('session', session.session);
    }
    if (adminSession) {
        c.set('admin', adminSession.user);
        c.set('adminSession', adminSession.session);
    }

    await next();
});

// Better Auth handlers — customers on /api/auth/*, the admin console on
// /api/admin/auth/* (must run before the /api/admin REST routes).
app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));
app.on(['POST', 'GET'], '/api/admin/auth/*', (c) =>
    adminAuth.handler(c.req.raw),
);

// Hotspot REST routes (mounted at /api/hotspot).
app.route('/api', routes);

app.get('/health', (c) => c.json({ status: 'ok' }));

// Global error fallback — same envelope as every other error response.
app.notFound((c) =>
    c.json(
        { success: false, message: 'Not found', type: ApiErrorType.NOT_FOUND },
        404,
    ),
);
app.onError((err, c) => {
    console.error(err);
    return c.json(
        {
            success: false,
            message: 'Internal server error',
            type: ApiErrorType.INTERNAL_ERROR,
        },
        500,
    );
});

console.log(`API listening on http://${env.baseUrl}}:${env.port}`);

// Converge the WireGuard interface to the database (source of truth) after
// restarts: re-asserts known peers and prunes stale ones. Never fatal.
void reconcileWireGuardPeers().catch((err) =>
    console.error('[wg] reconciliation error:', err),
);

// Flush the Bun SQL connection pool on shutdown. Without this, SIGINT/SIGTERM
// (and `bun run --watch` restarts) leave pooled Postgres connections open
// until they time out server-side. Guarded by globalThis so `bun --hot`
// re-evaluations of this module don't stack duplicate signal listeners.
const shutdownFlags = globalThis as unknown as {
    __pgShutdownRegistered?: boolean;
};
if (!shutdownFlags.__pgShutdownRegistered) {
    shutdownFlags.__pgShutdownRegistered = true;
    const shutdown = async (signal: string): Promise<void> => {
        console.log(`Received ${signal}, closing database pool...`);
        try {
            await closeDb();
        } catch (err) {
            console.error('Error closing database pool:', err);
        }
        process.exit(0);
    };
    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

export default {
    port: env.port,
    fetch: app.fetch,
};
