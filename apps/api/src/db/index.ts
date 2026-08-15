import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import * as schema from './schema';

const connectionString =
    process.env.DATABASE_URL ||
    'postgresql://postgres:lookup0p0...@127.0.0.1:5432/radii';

// Bun SQL pool tuning.
//
// Passing a bare connection string to drizzle() creates `new SQL(url)` with no
// options, which is a problem for three reasons:
//  - Bun <= 1.3.x opens the ENTIRE pool eagerly on the first query instead of
//    growing it on demand (oven-sh/bun#30632; fix PR #30636 still unmerged).
//  - The defaults are `idleTimeout: 0` / `maxLifetime: 0`, so once opened the
//    connections are held forever and never recycled.
//  - Under `bun --hot` the process survives module re-evaluation, so each
//    reload would otherwise leak a whole additional pool.
// Every session-middleware request touches the DB, so a pool fills up on the
// first burst of traffic; without idle expiry and a shutdown hook those
// connections sit there until Postgres rejects new clients ("too many
// clients already").
const poolOptions = {
    max: parseInt(process.env.PG_POOL_MAX || '10', 10),
    idleTimeout: 30,
    maxLifetime: 30 * 60,
    connectionTimeout: 15,
};

// Reuse a pool created by a previous `bun --hot` evaluation of this module so
// hot reloads never stack additional pools on top of each other.
const globalPool = globalThis as unknown as { __pgClient?: SQL };
const client = globalPool.__pgClient ?? new SQL(connectionString, poolOptions);
globalPool.__pgClient = client;

export const db = drizzle({ client, schema });

export async function closeDb(): Promise<void> {
    await client.close({ timeout: 5 });
}
