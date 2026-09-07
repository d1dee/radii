import type { AppContext } from '../types';
import { jsonError } from '../lib/error';

// Require an authenticated customer (portal) session — phone+PIN accounts on
// the customer BetterAuth instance (`user` table).
export async function requireAuth(
    c: AppContext,
    next: () => Promise<void>,
) {
    const user = c.get('user');
    if (!user) return jsonError(c, 401, 'Unauthorized');
    await next();
}

// Require an authenticated ADMIN console session — accounts on the dedicated
// admin BetterAuth instance (`admin_user` table). A customer session never
// satisfies this check (and vice versa): the instances, tables and cookies
// are fully isolated. Beyond registration source, an admin must (a) carry
// the 'admin' role and (b) have a verified email address (proven mailbox
// ownership via the 2FA-style OTP).
export async function requireAdmin(
    c: AppContext,
    next: () => Promise<void>,
) {
    const admin = c.get('admin');
    if (!admin) {
        return jsonError(c, 401, 'Unauthorized: admin sign-in required');
    }
    const roles = (admin.role as string | undefined)?.split(',') || ['user'];
    if (!roles.includes('admin')) {
        return jsonError(c, 403, 'Forbidden: admin role required');
    }
    if (!admin.emailVerified) {
        return jsonError(c, 403, 'Forbidden: admin email not verified');
    }
    await next();
}

// Require an admin console session carrying any of the given roles.
export function requireRole(...allowedRoles: string[]) {
    return async (c: AppContext, next: () => Promise<void>) => {
        const admin = c.get('admin');
        if (!admin) {
            return jsonError(c, 401, 'Unauthorized: admin sign-in required');
        }
        const roles = (admin.role as string | undefined)?.split(',') || [
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
