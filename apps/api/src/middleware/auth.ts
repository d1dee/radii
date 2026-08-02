import type { AppContext } from '../types';
import { jsonError } from '../lib/error';

// Require an authenticated session.
export async function requireAuth(
    c: AppContext,
    next: () => Promise<void>,
) {
    const user = c.get('user');
    if (!user) return jsonError(c, 401, 'Unauthorized');
    await next();
}

// Require a comma-separated role list to include "admin".
export async function requireAdmin(
    c: AppContext,
    next: () => Promise<void>,
) {
    const user = c.get('user');
    if (!user) return jsonError(c, 401, 'Unauthorized');
    const roles = (user.role as string | undefined)?.split(',') || ['user'];
    if (!roles.includes('admin')) {
        return jsonError(c, 403, 'Forbidden: admin role required');
    }
    await next();
}

// Require any of the given roles.
export function requireRole(...allowedRoles: string[]) {
    return async (c: AppContext, next: () => Promise<void>) => {
        const user = c.get('user');
        if (!user) return jsonError(c, 401, 'Unauthorized');
        const roles = (user.role as string | undefined)?.split(',') || [
            'user',
        ];
        const hasRole = allowedRoles.some((r) => roles.includes(r));
        if (!hasRole) {
            return jsonError(
                c,
                403,
                `Forbidden: requires one of [${allowedRoles.join(', ')}]`,
            );
        }
        await next();
    };
}
