import DBMigrate from 'db-migrate';
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

// Access the db-migrate instance
const dbmigrate = DBMigrate.getInstance(true, {
  env: 'test',
  config: {
    test: {
      driver: 'pg',
      connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@host.docker.internal:5432/polis-dev'
    }
  }
});

/**
 * Table order that respects foreign key constraints (dependent tables first)
 */
const TABLES_ORDER = [
  'comments',
  'votes',
  'math_ticks',
  'math_cache',
  'math_main',
  'comment_translations',
  'participants',
  'crowd_mod',
  'zinvites',
  'conversation_stats',
  'conversations',
  'auth_tokens',
  'jianiuevyew',
  'users'
];

/**
 * Tables that should be excluded from cleaning (e.g., schema tables)
 */
const EXCLUDE_TABLES = ['migrations', 'schema_version'];

/**
 * Clean specific tables in the database
 * @param {Array} tableNames - Tables to clean
 */
export async function cleanTables(tableNames) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const tableName of tableNames) {
      if (!EXCLUDE_TABLES.includes(tableName)) {
        try {
          await client.query(`TRUNCATE TABLE ${tableName} CASCADE`);
        } catch (err) {
          console.warn(`Failed to truncate table ${tableName}: ${err.message}`);
        }
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error during table cleanup:', err);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Clean all tables in the database in the correct order
 */
export async function cleanAllTables() {
  await cleanTables(TABLES_ORDER);
}

/**
 * Clean up test users and their related data
 * @param {string} emailPattern - Pattern to match test user emails
 */
export async function cleanupTestUsers(emailPattern = 'test.user.%@example.com') {
  const client = await pool.connect();

  try {
    // Find test users
    const testUsers = await client.query('SELECT uid FROM users WHERE email LIKE $1', [emailPattern]);

    if (testUsers.rows.length === 0) {
      return;
    }

    const uids = testUsers.rows.map((row) => row.uid);

    // Get conversations owned by these users
    const conversations = await client.query(`SELECT zid FROM conversations WHERE owner IN (${uids.join(',')})`);
    const zids = conversations.rows.map((row) => row.zid);

    if (zids.length > 0) {
      // Clean up in proper order (dependent tables first)
      const tablesToClean = [
        { name: 'comments', keyColumn: 'zid', values: zids },
        { name: 'votes', keyColumn: 'zid', values: zids },
        { name: 'math_ticks', keyColumn: 'zid', values: zids },
        { name: 'math_cache', keyColumn: 'zid', values: zids },
        { name: 'math_main', keyColumn: 'zid', values: zids },
        { name: 'comment_translations', keyColumn: 'zid', values: zids },
        { name: 'participants', keyColumn: 'zid', values: zids },
        { name: 'crowd_mod', keyColumn: 'zid', values: zids },
        { name: 'zinvites', keyColumn: 'zid', values: zids },
        { name: 'conversation_stats', keyColumn: 'zid', values: zids },
        { name: 'conversations', keyColumn: 'zid', values: zids }
      ];

      await cleanDataByKeys(client, tablesToClean);
    }

    // Clean up user related tables
    const userTablesToClean = [
      { name: 'auth_tokens', keyColumn: 'uid', values: uids },
      { name: 'jianiuevyew', keyColumn: 'uid', values: uids },
      { name: 'users', keyColumn: 'uid', values: uids }
    ];

    await cleanDataByKeys(client, userTablesToClean);
  } catch (err) {
    console.error('General error during test user cleanup:', err);
  } finally {
    client.release();
  }
}

/**
 * Clean data from multiple tables by specific key values
 * @param {Object} client - Database client
 * @param {Array} tablesToClean - Array of objects with table info
 */
async function cleanDataByKeys(client, tablesToClean) {
  for (const table of tablesToClean) {
    try {
      await client.query('BEGIN');

      if (table.values.length > 0) {
        const query = `DELETE FROM ${table.name} WHERE ${table.keyColumn} IN (${table.values.join(',')})`;
        await client.query(query);
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.warn(`Warning: Failed to delete from ${table.name}: ${err.message}`);
    }
  }
}

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
  dbmigrate,
  cleanTables,
  cleanAllTables,
  cleanupTestUsers,
  startTransaction,
  rollbackTransaction,
  closePool
};
