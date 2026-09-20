import { ApiErrorType } from '@radii/shared';
import { honoLogger } from '@logtape/hono';
import { Hono, type MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { adminAuth } from './adminAuth';
import { auth } from './auth';
import { closeDb } from './db';
import { env } from './env';
import { radiusClient } from './lib/radius';
import { reconcileWireGuardPeers } from './lib/wgReconcile';
import { apiLogger, disposeLogging } from './logging';
import routes from './routes';
import type { AppVariables } from './types';

// FreeRADIUS SQL runs before REST. Remove legacy PPPoE Expiration/static reply
// rows before accepting traffic so REST exclusively selects normal versus
// payment-only profiles while SQL continues to verify the stable password.
await radiusClient.preparePppoeRestAuthorization();

const app = new Hono<{ Variables: AppVariables }>();
const logger = apiLogger.getChild('server');

if (!env.frontendUrls.length) {
    throw new Error('FRONTEND_URLS must contain at least one origin');
}

app.use(
    honoLogger({
        category: ['radii', 'api', 'http'],
        format: (c, responseTime) => ({
            method: c.req.method,
            path: c.req.matchedRoutes.at(-1)?.path ?? '<unmatched>',
            status: c.res.status,
            responseTime,
            contentLength: c.res.headers.get('content-length') ?? undefined,
        }),
        context: {
            requestId: {
                headerNames: ['x-correlation-id', 'x-request-id'],
                responseHeader: 'x-request-id',
                normalize: (value) =>
                    /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : null,
            },
            include: ['requestId', 'method'],
            enrich: (c) => ({
                path: c.req.matchedRoutes.at(-1)?.path ?? '<unmatched>',
            }),
        },
    }) as unknown as MiddlewareHandler<{ Variables: AppVariables }>,
);

// CORS — applied to all API routes (auth + REST).
app.use(
    '/api/*',
    cors({
        origin: [...env.frontendUrls, ...env.adminFrontendUrls],
        allowHeaders: ['Content-Type', 'Authorization'],
        allowMethods: ['POST', 'GET', 'OPTIONS', 'PUT', 'DELETE'],
        exposeHeaders: ['Content-Length', 'X-Request-Id'],
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
    logger.error('Unhandled request error', {
        error: err,
        method: c.req.method,
        path: c.req.matchedRoutes.at(-1)?.path ?? '<unmatched>',
    });
    return c.json(
        {
            success: false,
            message: 'Internal server error',
            type: ApiErrorType.INTERNAL_ERROR,
        },
        500,
    );
});

// Converge the WireGuard interface to the database (source of truth) after
// restarts: re-asserts known peers and prunes stale ones. Never fatal.
void reconcileWireGuardPeers().catch((err) =>
    logger.error('WireGuard reconciliation failed', { error: err }),
);

// Flush the Bun SQL connection pool on shutdown.
const shutdownFlags = globalThis as unknown as {
    __pgShutdownRegistered?: boolean;
};
if (!shutdownFlags.__pgShutdownRegistered) {
    shutdownFlags.__pgShutdownRegistered = true;
    const shutdown = async (signal: string): Promise<void> => {
        logger.info('Shutting down API server', { signal });
        try {
            await closeDb();
        } catch (err) {
            logger.error('Database pool shutdown failed', { error: err });
        }
        await disposeLogging();
        process.exit(0);
    };
    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

const server = Bun.serve({
    hostname: process.env.SERVER_ADDRESS,
    port: process.env.SERVER_PORT,
    fetch: app.fetch,
});

logger.info('API server started', {
    protocol: server.protocol,
    hostname: server.hostname,
    port: server.port,
});
