import { afterAll, beforeAll, jest } from '@jest/globals';
import dotenv from 'dotenv';
import dbHelpers from './db-test-helpers.js';

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

// Run the safety check before any tests
preventProductionDatabaseTesting();

// Increase timeout for all tests
jest.setTimeout(30000);

// Setup global hooks
beforeAll(async () => {
  console.log('Global setup: Setting up test environment');

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
  console.log('Global teardown: Cleaning up test environment');

  // Close database connection
  await dbHelpers.closePool();
});
