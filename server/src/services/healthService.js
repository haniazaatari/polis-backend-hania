import { testConnection } from '../../db/health.js';

/**
 * Test the database connection by running a simple query
 * @returns {Promise<void>} - Resolves if the database connection is successful
 */
async function testDatabaseConnection() {
  await testConnection();
}

export { testDatabaseConnection };
