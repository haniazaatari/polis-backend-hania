import logger from '../utils/logger.js';
import { query_readOnly } from './pg-query.js';

/**
 * Get user records for an API key
 * @param {string} apiKey - API key
 * @returns {Promise<Array>} - Array of user records
 */
async function getUserRecordsByApiKey(apiKey) {
  try {
    return await query_readOnly('SELECT * FROM apikeysndvweifu WHERE apikey = ($1);', [apiKey]);
  } catch (err) {
    logger.error('Error getting user records by API key', err);
    throw err;
  }
}

export { getUserRecordsByApiKey };
