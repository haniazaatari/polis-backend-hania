import { exec } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { afterAll, beforeAll, jest } from '@jest/globals';
import dotenv from 'dotenv';
import dbHelpers from './db-test-helpers.js';

// Setup dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execAsync = promisify(exec);

dotenv.config();

/**
 * Secondary safety check to prevent tests from running against production databases
 * This is a redundant check in case db-test-helpers.js is not loaded first
 */
function preventProductionDatabaseTesting() {
  const dbUrl = process.env.DATABASE_URL || '';

  if (dbUrl.toLowerCase().includes('amazonaws') || dbUrl.toLowerCase().includes('prod')) {
    console.error('\x1b[31m%s\x1b[0m', '❌ CRITICAL SECURITY WARNING ❌');
    console.error('\x1b[31m%s\x1b[0m', 'Tests appear to be targeting a PRODUCTION database!');
    console.error('\x1b[31m%s\x1b[0m', 'Tests are being aborted to prevent data loss or corruption.');
    process.exit(1);
  }
}

/**
 * Reset the database by running the db-reset.js script
 * This will be used when the RESET_DB_BEFORE_TESTS environment variable is set
 */
async function resetDatabase() {
  console.log('\n🔄 Resetting database before tests...');

  try {
    const resetScript = path.join(__dirname, '..', '..', 'bin', 'db-reset.js');
    const { stdout, stderr } = await execAsync(`node ${resetScript}`, {
      env: { ...process.env, SKIP_CONFIRM: 'true' }
    });

    console.log('\n✅ Database reset complete!');

    if (stderr) {
      console.error('stderr:', stderr);
    }
  } catch (error) {
    console.error('\n❌ Failed to reset database:', error);
    throw error;
  }
}

// Run the safety check before any tests
preventProductionDatabaseTesting();

// Increase timeout for all tests
jest.setTimeout(3000);

// Setup global hooks
beforeAll(async () => {
  console.log('Global setup: Setting up test environment');

  // Reset database if requested via environment variable
  if (process.env.RESET_DB_BEFORE_TESTS === 'true') {
    await resetDatabase();
  }

  // Make sure database is available
  try {
    const client = await dbHelpers.pool.connect();
    console.log('Successfully connected to database');
    client.release();
  } catch (error) {
    console.error('Failed to connect to database:', error);
    throw error; // Fail fast if we can't connect to the database
  }
});

afterAll(async () => {
  // Close database connection
  await dbHelpers.closePool();
});
