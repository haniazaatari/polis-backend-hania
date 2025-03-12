import { queryP, queryP_readOnly } from '../../db/pg-query.js';

/**
 * Get user ID for an API key
 * @param {string} apiKey - The API key
 * @returns {Promise<number|null>} - The user ID or null if not found
 */
async function getUserIdForApiKey(apiKey) {
  const results = await queryP_readOnly('SELECT uid FROM apikeysndvweifu WHERE apikey = ($1);', [apiKey]);
  return results.length ? Number(results[0].uid) : null;
}

/**
 * Create a new API key for a user
 * @param {number} uid - The user ID
 * @returns {Promise<string>} - The created API key
 */
async function createApiKey(uid) {
  const results = await queryP('INSERT INTO apikeysndvweifu (uid, apikey) VALUES ($1, $2) RETURNING apikey;', [
    uid,
    makeApiKey()
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

/**
 * Generate a new API key
 * @returns {string} - A new API key
 * @private
 */
function makeApiKey() {
  // This should be moved to a utility function
  return Math.random().toString(36).substr(2) + Math.random().toString(36).substr(2);
}

export { getUserIdForApiKey, createApiKey, deleteApiKey };
