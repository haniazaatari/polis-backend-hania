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

// Load environment variables from .env file but don't override command-line vars
dotenv.config({ override: false });

/**
 * Secondary safety check to prevent tests from running against production databases
 * This is a redundant check in case db-test-helpers.js is not loaded first
 */
function preventProductionDatabaseTesting() {
  const dbUrl = process.env.DATABASE_URL || '';

  if (dbUrl.toLowerCase().includes('amazonaws') || dbUrl.toLowerCase().includes('prod')) {
    process.exit(1);
  }
}

/**
 * Reset the database by running the db-reset.js script
 * This will be used when the RESET_DB_BEFORE_TESTS environment variable is set
 */
async function resetDatabase() {
  const resetScript = path.join(__dirname, '..', '..', 'bin', 'db-reset.js');
  const { stdout, stderr } = await execAsync(`node ${resetScript}`, {
    env: { ...process.env, SKIP_CONFIRM: 'true' }
  });

  if (stderr) {
  }
}

// Run the safety check before any tests
preventProductionDatabaseTesting();

// Increase timeout for all tests
jest.setTimeout(60000);

// Setup global hooks
beforeAll(async () => {
  // Reset database if requested via environment variable
  if (process.env.RESET_DB_BEFORE_TESTS === 'true') {
    await resetDatabase();
  }
  const client = await dbHelpers.pool.connect();
  client.release();
});

afterAll(async () => {
  // Close database connection
  await dbHelpers.closePool();
});
