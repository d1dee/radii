import { ApiErrorType } from '@radii/shared';
import { honoLogger } from '@logtape/hono';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { adminAuth } from './adminAuth';
import { auth } from './auth';
import { closeDb } from './db';
import { env } from './env';
import { radiusClient } from './lib/radius';
import { startNasSessionReconciliation } from './lib/radius/sessionReconcile';
import { reconcileWireGuardPeers } from './lib/wgReconcile';
import { apiLogger, disposeLogging } from './logging';
import { rateLimit } from './middleware/rateLimit';
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

// Per-IP rate limiting — placed AFTER CORS (so 429 responses still carry
// CORS headers for browser clients) and BEFORE session resolution (so
// floods are dropped without paying for the two better-auth getSession DB
// lookups on every request). Exemptions (/api/radius/rest/*, /api/nas/*)
// live inside the middleware; /health is not under /api/* and never limited.
app.use('/api/*', rateLimit);

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

// Blocked better-auth routes answer with the same envelope as app.notFound.
const blockedRoute = (c: Context<{ Variables: AppVariables }>) =>
    c.json(
        { success: false, message: 'Not found', type: ApiErrorType.NOT_FOUND },
        404,
    );

// The better-auth admin plugin's endpoints (/api/admin/auth/admin/*) are
// globally scoped: any admin could manage any other tenant's admin
// (list-users, list-user-sessions with RAW session tokens, set-user-password,
// ban-user, ...). Tenant-scoped management lives in the /api/admin REST
// routes, so these are blocked unless ALLOW_ADMIN_PLUGIN_ROUTES is exactly
// 'true' (the plugin itself also denies every role — see adminAuth.ts).
// Registered BEFORE the wildcard below so it wins the match deterministically.
if (!env.allowAdminPluginRoutes) {
    app.on(['POST', 'GET'], '/api/admin/auth/admin/*', blockedRoute);
}

// Customers authenticate through the portal REST routes (lib/authHelpers.ts
// calls auth.api.* server-side); the raw email sign-up/sign-in HTTP routes on
// the CUSTOMER instance are unintended brute-force surface for the 4-digit
// PIN and stay blocked. The same applies to sign-in/username: the portal
// /login REST flow wraps auth.api.signInUsername with the per-account PIN
// lockout, while the raw HTTP route would bypass it — no frontend calls it.
// The customer instance's admin plugin surface (/api/auth/admin/*) is
// globally scoped and unused (tenant management lives in the admin instance
// and the /api/admin REST routes), so it is blocked deterministically like
// the admin instance's /api/admin/auth/admin/* above. Paths the portals do
// need over HTTP (e.g. GET /api/auth/get-session for useSession) and the
// admin console's own login (/api/admin/auth/sign-in/email) are untouched.
app.on(['POST', 'GET'], '/api/auth/sign-up/email', blockedRoute);
app.on(['POST', 'GET'], '/api/auth/sign-in/email', blockedRoute);
app.on(['POST', 'GET'], '/api/auth/sign-in/username', blockedRoute);
app.on(['POST', 'GET'], '/api/auth/admin/*', blockedRoute);

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
void reconcileWireGuardPeers()
    .catch((err) => logger.error('WireGuard reconciliation failed', { error: err }))
    .finally(() => startNasSessionReconciliation());


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
