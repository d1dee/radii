import type { Context } from 'hono';
import type { auth } from './auth';

// Session user/session shapes inferred from the better-auth instance.
export type SessionUser = (typeof auth)['$Infer']['Session']['user'];
export type SessionSession = (typeof auth)['$Infer']['Session']['session'];

export type AppVariables = {
    user: SessionUser;
    session: SessionSession;
};

export type AppContext = Context<{ Variables: AppVariables }>;
