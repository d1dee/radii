import type { Context } from 'hono';
import type { adminAuth } from './adminAuth';
import type { auth } from './auth';
import type { agentAuth } from './agentAuth';

// Session user/session shapes inferred from the better-auth instances.
// Customer (portal) sessions — phone+PIN accounts in the `user` table.
export type SessionUser = (typeof auth)['$Infer']['Session']['user'];
export type SessionSession = (typeof auth)['$Infer']['Session']['session'];
// Admin console sessions — email accounts in the isolated `admin_user` table.
export type AdminSessionUser =
    (typeof adminAuth)['$Infer']['Session']['user'];
export type AdminSessionSession =
    (typeof adminAuth)['$Infer']['Session']['session'];

export type AppVariables = {
    user: SessionUser;
    session: SessionSession;
    admin: AdminSessionUser;
    adminSession: AdminSessionSession;
    agentIdentity: NonNullable<Awaited<ReturnType<typeof agentAuth.api.getSession>>>;
};

export type AppContext = Context<{ Variables: AppVariables }>;
