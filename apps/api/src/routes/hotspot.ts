import { Hono } from 'hono';
import type { Context } from 'hono';
import type { auth } from '../auth';

type AuthContext = Context<{
	Variables: {
		user: typeof auth.$Infer.Session.user | null;
		session: typeof auth.$Infer.Session.session | null;
	};
}>;

// Middleware: require authentication
export const requireAuth = async (c: AuthContext, next: () => Promise<void>) => {
	const user = c.get('user');
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401);
	}
	await next();
};

// Middleware: require admin role
export const requireAdmin = async (c: AuthContext, next: () => Promise<void>) => {
	const user = c.get('user');
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401);
	}
	const roles = (user.role as string)?.split(',') || ['user'];
	if (!roles.includes('admin')) {
		return c.json({ error: 'Forbidden: admin role required' }, 403);
	}
	await next();
};

// Middleware: require any of the given roles
export const requireRole = (...allowedRoles: string[]) => {
	return async (c: AuthContext, next: () => Promise<void>) => {
		const user = c.get('user');
		if (!user) {
			return c.json({ error: 'Unauthorized' }, 401);
		}
		const roles = (user.role as string)?.split(',') || ['user'];
		const hasRole = allowedRoles.some((r) => roles.includes(r));
		if (!hasRole) {
			return c.json({ error: `Forbidden: requires one of [${allowedRoles.join(', ')}]` }, 403);
		}
		await next();
	};
};

const app = new Hono<{
	Variables: {
		user: typeof auth.$Infer.Session.user | null;
		session: typeof auth.$Infer.Session.session | null;
	};
}>();

type Package = {
	packageId: string;
	createdAt?: string;
	title: string;
	category: string;
	initialSessionLength: number;
	price: number;
	maxDevices: number;
	noExpiry: boolean;
	note?: string;
	description?: string;
	uploadRate: number;
	downloadQuota: number;
	downloadRate: number;
	uploadQuota: number;
	gateway?: string;
};

// Public endpoint: anyone can view packages
app.get('/package', (c) => {
	const packages: Array<[string, Package[]]> = [
		[
			'daily',
			[
				{
					packageId: 'pkg-daily-1',
					title: 'Daily Basic',
					category: 'daily',
					initialSessionLength: 60,
					price: 10,
					maxDevices: 1,
					noExpiry: false,
					description: '1 hour internet access',
					uploadRate: 1024,
					downloadRate: 2048,
					downloadQuota: 100 * 1024,
					uploadQuota: 50 * 1024,
				},
				{
					packageId: 'pkg-daily-2',
					title: 'Daily Plus',
					category: 'daily',
					initialSessionLength: 180,
					price: 25,
					maxDevices: 2,
					noExpiry: false,
					description: '3 hours internet access',
					uploadRate: 2048,
					downloadRate: 4096,
					downloadQuota: 300 * 1024,
					uploadQuota: 150 * 1024,
				},
			],
		],
		[
			'weekly',
			[
				{
					packageId: 'pkg-weekly-1',
					title: 'Weekly Standard',
					category: 'weekly',
					initialSessionLength: 10080,
					price: 100,
					maxDevices: 3,
					noExpiry: false,
					description: '7 days internet access',
					uploadRate: 2048,
					downloadRate: 4096,
					downloadQuota: 2000 * 1024,
					uploadQuota: 1000 * 1024,
				},
			],
		],
	];

	return c.json(packages);
});

// Admin-only endpoint: create a package (example)
app.post('/package', requireAdmin, async (c) => {
	const body = await c.req.json<Partial<Package>>();
	// In a real app, persist to DB here
	return c.json({ message: 'Package created', data: body }, 201);
});

// Protected endpoint: any authenticated user can access their own info
app.get('/me', requireAuth, (c) => {
	const user = c.get('user');
	return c.json({ user });
});

// Admin-only endpoint: list all users (delegates to better-auth admin API)
app.get('/users', requireAdmin, async (c) => {
	const { auth } = await import('../auth');
	const data = await auth.api.listUsers({
		query: { limit: 100 },
		headers: c.req.raw.headers,
	});
	return c.json(data);
});

export default app;
