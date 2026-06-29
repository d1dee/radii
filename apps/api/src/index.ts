import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { auth } from './auth';
import hotspot from './routes/hotspot';

const app = new Hono<{
	Variables: {
		user: typeof auth.$Infer.Session.user | null;
		session: typeof auth.$Infer.Session.session | null;
	};
}>();

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const PORT = parseInt(process.env.PORT || '3000');
const FRONTEND_URLS = (process.env.FRONTEND_URLS || 'http://localhost:5174,http://localhost:5175').split(',');

app.use(logger());

// CORS for auth endpoints
app.use(
	'/api/auth/*',
	cors({
		origin: FRONTEND_URLS,
		allowHeaders: ['Content-Type', 'Authorization'],
		allowMethods: ['POST', 'GET', 'OPTIONS', 'PUT', 'DELETE'],
		exposeHeaders: ['Content-Length'],
		maxAge: 600,
		credentials: true,
	}),
);

// CORS for general API
app.use(
	'/api/*',
	cors({
		origin: FRONTEND_URLS,
		allowHeaders: ['Content-Type', 'Authorization'],
		allowMethods: ['POST', 'GET', 'OPTIONS', 'PUT', 'DELETE'],
		exposeHeaders: ['Content-Length'],
		maxAge: 600,
		credentials: true,
	}),
);

// Session middleware: attach user/session to all routes
app.use('*', async (c, next) => {
	const session = await auth.api.getSession({
		headers: c.req.raw.headers,
	});

	if (!session) {
		c.set('user', null);
		c.set('session', null);
		await next();
		return;
	}

	c.set('user', session.user);
	c.set('session', session.session);
	await next();
});

// Better Auth handler
app.on(['POST', 'GET'], '/api/auth/*', (c) => {
	return auth.handler(c.req.raw);
});

// Hotspot routes
app.route('/api/hotspot', hotspot);

app.get('/health', (c) => c.json({ status: 'ok' }));

export default {
	port: PORT,
	fetch: app.fetch,
};
