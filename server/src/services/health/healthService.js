import { queryP } from '../../db/pg-query.js';

/**
 * Test the database connection by running a simple query
 * @returns {Promise<void>} - Resolves if the database connection is successful
 */
function testDatabaseConnection() {
  return queryP('select uid from users limit 1', []).then((_rows) => {
    // Connection successful
    return;
  });
}

export { testDatabaseConnection };
