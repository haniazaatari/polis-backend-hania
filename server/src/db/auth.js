import logger from '../utils/logger.js';
import { queryP } from './pg-query.js';

/**
 * Store a user's password hash
 * @param {number} uid - User ID
 * @param {string} pwhash - Hashed password
 * @returns {Promise<void>}
 */
async function storePasswordHash(uid, pwhash) {
  try {
    await queryP('INSERT INTO jianiuevyew (uid, pwhash) VALUES ($1, $2);', [uid, pwhash]);
  } catch (error) {
    logger.error('Error storing password hash', error);
    throw error;
  }
}

/**
 * Get password hash for a user
 * @param {number} uid - User ID
 * @returns {Promise<string|null>} Password hash or null if not found
 */
async function getPasswordHash(uid) {
  try {
    const results = await queryP('SELECT pwhash FROM jianiuevyew WHERE uid = $1;', [uid]);
    return results.length ? results[0].pwhash : null;
  } catch (error) {
    logger.error('Error getting password hash', error);
    throw error;
  }
}

/**
 * Update password hash for a user
 * @param {number} uid - User ID
 * @param {string} pwhash - New hashed password
 * @returns {Promise<void>}
 */
async function updatePasswordHash(uid, pwhash) {
  try {
    await queryP('UPDATE jianiuevyew SET pwhash = $1 WHERE uid = $2;', [pwhash, uid]);
  } catch (error) {
    logger.error('Error updating password hash', error);
    throw error;
  }
}

export { storePasswordHash, getPasswordHash, updatePasswordHash };
