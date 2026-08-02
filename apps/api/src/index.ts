import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { auth } from './auth';
import { env } from './env';
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
        origin: env.frontendUrls,
        allowHeaders: ['Content-Type', 'Authorization'],
        allowMethods: ['POST', 'GET', 'OPTIONS', 'PUT', 'DELETE'],
        exposeHeaders: ['Content-Length'],
        maxAge: 600,
        credentials: true,
    }),
);

// Session middleware: resolve the better-auth session for every request and
// attach it (or null) to the context for downstream handlers.
app.use('*', async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    c.set('user', session ? session.user : null);
    c.set('session', session ? session.session : null);
    await next();
});

// Better Auth handler.
app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));

// Hotspot REST routes (mounted at /api/hotspot).
app.route('/api', routes);

app.get('/health', (c) => c.json({ status: 'ok' }));

// Global error fallback.
app.notFound((c) => c.json({ success: false, error: 'Not found' }, 404));
app.onError((err, c) => {
    console.error(err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
});

console.log(`API listening on http://localhost:${env.port}`);

export default {
    port: env.port,
    fetch: app.fetch,
};
