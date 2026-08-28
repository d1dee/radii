import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import * as schema from './schema';

const connectionString =
    process.env.DATABASE_URL ||
    'postgresql://postgres:lookup0p0...@127.0.0.1:5432/radii';

// Bun SQL pool tuning to avoid Postgres rejecting new clients with ("too many clients already").
const poolOptions = {
    max: parseInt(process.env.PG_POOL_MAX || '10', 10),
    idleTimeout: 30,
    maxLifetime: 30 * 60,
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
