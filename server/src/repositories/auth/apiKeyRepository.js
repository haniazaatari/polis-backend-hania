import {
  createApiKey as dbCreateApiKey,
  deleteApiKey as dbDeleteApiKey,
  getUserIdForApiKey as dbGetUserIdForApiKey
} from '../../db/apiKeys.js';

/**
 * Get user ID for an API key
 * @param {string} apiKey - The API key
 * @returns {Promise<number|null>} - The user ID or null if not found
 */
async function getUserIdForApiKey(apiKey) {
  return dbGetUserIdForApiKey(apiKey);
}

/**
 * Create a new API key for a user
 * @param {number} uid - The user ID
 * @returns {Promise<string>} - The created API key
 */
async function createApiKey(uid) {
  return dbCreateApiKey(uid, makeApiKey());
}

/**
 * Delete an API key
 * @param {string} apiKey - The API key to delete
 * @returns {Promise<void>}
 */
async function deleteApiKey(apiKey) {
  return dbDeleteApiKey(apiKey);
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
