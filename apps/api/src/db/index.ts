import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:lookup0p0...@127.0.0.1:5432/radii';

const pool = new Pool({ connectionString });

export const db = drizzle(pool, { schema });
