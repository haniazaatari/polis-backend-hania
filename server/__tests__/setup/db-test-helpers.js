import dotenv from 'dotenv';
import pg from 'pg';

// Load environment variables from .env file but don't override command-line vars
dotenv.config({ override: false });

/**
 * SECURITY CHECK: Prevent running tests against production databases
 * This function checks if the DATABASE_URL contains indicators of a production database
 * and will exit the process if a production database is detected.
 */
function preventProductionDatabaseTesting() {
  const dbUrl = process.env.DATABASE_URL || '';
  const productionIndicators = ['amazonaws', 'prod'];

  for (const indicator of productionIndicators) {
    if (dbUrl.toLowerCase().includes(indicator)) {
      // Exit with non-zero code to indicate error
      process.exit(1);
    }
  }
}

// Run the security check immediately
preventProductionDatabaseTesting();

const { Pool } = pg;

// Use host.docker.internal to connect to the host machine's PostgreSQL instance
// This works when running tests from the host machine
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@host.docker.internal:5432/polis-dev'
});

/**
 * Close the database pool
 */
async function closePool() {
  await pool.end();
}

export default {
  pool,
  closePool
};
