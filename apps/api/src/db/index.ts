import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { env } from '../env';
import * as schema from './schema';

const connectionString = env.databaseUrl;

// Bun SQL pool tuning to avoid Postgres rejecting new clients with ("too many clients already").
const poolOptions = {
    max: parseInt(process.env.PG_POOL_MAX || '10', 10),
    // Older Bun SQL releases close in-flight queries when either timer fires
    // (oven-sh/bun#30646). Keep the bounded pool until shutdown instead.
    idleTimeout: 0,
    maxLifetime: 0,
    connectionTimeout: 15,
};

// Reuse a pool created by a previous `bun --hot` evaluation of this module so
// hot reloads never stack additional pools on top of each other.
const globalPool = globalThis as unknown as { __pgClient?: SQL };

globalPool.__pgClient = !globalPool?.__pgClient
    ? new SQL(connectionString, poolOptions)
    : globalPool?.__pgClient;

const client = globalPool.__pgClient;
export const db = drizzle({ client, schema });

export async function closeDb(): Promise<void> {
    await client.close({ timeout: 5 });
}
