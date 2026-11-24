import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { migrate } from 'drizzle-orm/bun-sql/migrator';
import { fileURLToPath } from 'node:url';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to run database migrations');
}

// One persistent connection keeps the advisory lock held during migration transactions.
const client = new SQL(databaseUrl, {
    max: 1,
    idleTimeout: 0,
    maxLifetime: 0,
    connectionTimeout: 15,
});

try {
    console.log('[database-migrations] Waiting for deployment migration lock');
    await client`SELECT pg_advisory_lock(724234, 1)`;
    await migrate(drizzle({ client }), {
        migrationsFolder: fileURLToPath(new URL('../../drizzle/', import.meta.url)),
    });
    console.log('[database-migrations] Schema is up to date');
} finally {
    // Closing the session also releases its advisory lock after failures.
    await client.close({ timeout: 5 });
}
