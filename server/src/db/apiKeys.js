import logger from '../utils/logger.js';
import { queryP, query_readOnly } from './pg-query.js';

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

/**
 * Get user ID for an API key
 * @param {string} apiKey - The API key
 * @returns {Promise<number|null>} - The user ID or null if not found
 */
async function getUserIdForApiKey(apiKey) {
  const results = await query_readOnly('SELECT uid FROM apikeysndvweifu WHERE apikey = ($1);', [apiKey]);
  return results.length ? Number(results[0].uid) : null;
}

/**
 * Create a new API key for a user
 * @param {number} uid - The user ID
 * @param {string} apiKey - The API key to create
 * @returns {Promise<string>} - The created API key
 */
async function createApiKey(uid, apiKey) {
  const results = await queryP('INSERT INTO apikeysndvweifu (uid, apikey) VALUES ($1, $2) RETURNING apikey;', [
    uid,
    apiKey
  ]);
  return results[0].apikey;
}

/**
 * Delete an API key
 * @param {string} apiKey - The API key to delete
 * @returns {Promise<void>}
 */
async function deleteApiKey(apiKey) {
  return queryP('DELETE FROM apikeysndvweifu WHERE apikey = ($1);', [apiKey]);
}

export { getUserRecordsByApiKey, getUserIdForApiKey, createApiKey, deleteApiKey };
