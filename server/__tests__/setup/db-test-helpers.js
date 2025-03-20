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
      // Use console.error for high visibility
      console.error('\x1b[31m%s\x1b[0m', '❌ CRITICAL SECURITY WARNING ❌');
      console.error('\x1b[31m%s\x1b[0m', 'Tests appear to be targeting a PRODUCTION database!');
      console.error(
        '\x1b[31m%s\x1b[0m',
        `DATABASE_URL contains "${indicator}", which suggests a production environment.`
      );
      console.error('\x1b[31m%s\x1b[0m', 'Tests are being aborted to prevent data loss or corruption.');
      console.error('\x1b[31m%s\x1b[0m', 'If this is incorrect, please modify the DATABASE_URL environment variable.');

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
 * Start a transaction for a test
 * Use this in beforeEach hooks to isolate test data changes
 */
export async function startTransaction() {
  const client = await pool.connect();
  await client.query('BEGIN');
  return client;
}

/**
 * Roll back a transaction after a test
 * Use this in afterEach hooks to clean up test data changes
 * @param {Object} client - Database client with active transaction
 */
export async function rollbackTransaction(client) {
  try {
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
}

/**
 * Close the database pool
 */
export async function closePool() {
  await pool.end();
}

export default {
  pool,
  startTransaction,
  rollbackTransaction,
  closePool
};
