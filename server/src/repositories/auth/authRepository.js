import {
  getPasswordHash as dbGetPasswordHash,
  storePasswordHash as dbStorePasswordHash,
  updatePasswordHash as dbUpdatePasswordHash
} from '../../db/auth.js';

/**
 * Store a user's password hash in the jianiuevyew table
 * @param {number} uid - User ID
 * @param {string} pwhash - Hashed password
 * @returns {Promise<void>}
 */
async function storePasswordHash(uid, pwhash) {
  return dbStorePasswordHash(uid, pwhash);
}

/**
 * Get password hash for a user from jianiuevyew table
 * @param {number} uid - User ID
 * @returns {Promise<string|null>} Password hash or null if not found
 */
async function getPasswordHash(uid) {
  return dbGetPasswordHash(uid);
}

/**
 * Update password hash for a user in jianiuevyew table
 * @param {number} uid - User ID
 * @param {string} pwhash - New hashed password
 * @returns {Promise<void>}
 */
async function updatePasswordHash(uid, pwhash) {
  return dbUpdatePasswordHash(uid, pwhash);
}

export { storePasswordHash, getPasswordHash, updatePasswordHash };
