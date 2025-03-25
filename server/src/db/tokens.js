import { queryP, queryP_readOnly } from './pg-query.js';

/**
 * Get user ID for a session token
 * @param {string} token - The session token
 * @returns {Promise<number|null>} - The user ID or null if not found
 */
async function getUserIdForToken(token) {
  const results = await queryP_readOnly('SELECT uid FROM auth_tokens WHERE token = ($1);', [token]);
  return results.length ? results[0].uid : null;
}

/**
 * Delete a session token
 * @param {string} token - The session token
 * @returns {Promise<void>}
 */
async function deleteToken(token) {
  await queryP('DELETE FROM auth_tokens WHERE token = ($1);', [token]);
}

/**
 * Create a new session token
 * @param {number} uid - The user ID
 * @param {string} token - The session token
 * @returns {Promise<void>}
 */
async function createSessionToken(uid, token) {
  await queryP('INSERT INTO auth_tokens (uid, token, created) VALUES ($1, $2, default);', [uid, token]);
}

/**
 * Get user ID for a password reset token
 * @param {string} token - The password reset token
 * @returns {Promise<number|null>} - The user ID or null if not found
 */
async function getUserIdForPasswordResetToken(token) {
  const results = await queryP_readOnly('SELECT uid FROM pwreset_tokens WHERE token = ($1);', [token]);
  return results.length ? results[0].uid : null;
}

/**
 * Create a password reset token
 * @param {number} uid - The user ID
 * @param {string} token - The password reset token
 * @returns {Promise<void>}
 */
async function createPasswordResetToken(uid, token) {
  await queryP('INSERT INTO pwreset_tokens (uid, token, created) VALUES ($1, $2, default);', [uid, token]);
}

/**
 * Clear a password reset token
 * @param {string} token - The password reset token
 * @returns {Promise<void>}
 */
async function clearPasswordResetToken(token) {
  await queryP('DELETE FROM pwreset_tokens WHERE token = ($1);', [token]);
}

/**
 * Get user ID for a verification token
 * @param {string} token - The verification token
 * @returns {Promise<number|null>} - The user ID or null if not found
 */
async function getUserIdForVerificationToken(token) {
  const results = await queryP_readOnly('SELECT uid FROM einvites WHERE einvite = ($1);', [token]);
  return results.length ? results[0].uid : null;
}

/**
 * Create a verification token
 * @param {number} uid - The user ID
 * @param {string} token - The verification token
 * @returns {Promise<void>}
 */
async function createVerificationToken(uid, token) {
  await queryP('INSERT INTO einvites (uid, einvite, created) VALUES ($1, $2, default);', [uid, token]);
}

/**
 * Clear a verification token
 * @param {string} token - The verification token
 * @returns {Promise<void>}
 */
async function clearVerificationToken(token) {
  await queryP('DELETE FROM einvites WHERE einvite = ($1);', [token]);
}

export {
  clearPasswordResetToken,
  clearVerificationToken,
  createPasswordResetToken,
  createSessionToken,
  createVerificationToken,
  deleteToken,
  getUserIdForPasswordResetToken,
  getUserIdForToken,
  getUserIdForVerificationToken
};
