import { drizzle } from 'drizzle-orm/bun-sql';
import * as schema from './schema';

const connectionString =
    process.env.DATABASE_URL ||
    'postgresql://postgres:lookup0p0...@127.0.0.1:5432/radii';

export const db = drizzle(connectionString, { schema });
