/**
 * Context Repository
 * Handles database operations for contexts
 */
import { queryP, queryP_readOnly } from '../../db/pg-query.js';

/**
 * Get all public contexts
 * @returns {Promise<Array>} - Array of public contexts
 */
async function getPublicContexts() {
  return queryP_readOnly('SELECT name FROM contexts WHERE is_public = TRUE ORDER BY name;', []);
}

/**
 * Get a context by name
 * @param {string} name - The name of the context to find
 * @returns {Promise<Object|null>} - The context object or null if not found
 */
async function getContextByName(name) {
  const results = await queryP_readOnly('SELECT * FROM contexts WHERE name = ($1);', [name]);
  return results.length ? results[0] : null;
}

/**
 * Create a new context
 * @param {string} name - The name of the context
 * @param {number} uid - The user ID of the creator
 * @returns {Promise<void>}
 */
async function createContext(name, uid) {
  await queryP('INSERT INTO contexts (name, creator, is_public) VALUES ($1, $2, $3);', [name, uid, true]);
}

export { getPublicContexts, getContextByName, createContext };
