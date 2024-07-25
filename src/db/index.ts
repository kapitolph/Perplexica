import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

// Load environment variables
import * as dotenv from 'dotenv';
dotenv.config();

// Use the environment variable for the connection string
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not set in the environment variables');
}

// Create a new pool using the connection string
const pool = new Pool({
  connectionString,
});

// Create the drizzle database instance
const db = drizzle(pool, { schema });

export default db;