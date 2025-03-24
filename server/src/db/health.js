import { queryP } from './pg-query.js';

/**
 * Run a simple database query to test connection
 * @returns {Promise<Array>} Query results
 */
async function testConnection() {
  return await queryP('select uid from users limit 1', []);
}

export { testConnection };
