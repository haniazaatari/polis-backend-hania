import { queryP, queryP_readOnly } from './pg-query.js';

/**
 * Get einvite information
 * @param {string} einvite - The einvite token
 * @returns {Promise<Object|null>} - Einvite info or null if not found
 */
async function getEinviteInfo(einvite) {
  const rows = await queryP_readOnly('select * from einvites where einvite = ($1);', [einvite]);
  return rows.length ? rows[0] : null;
}

/**
 * Create a new einvite
 * @param {string} email - The recipient's email
 * @param {string} einvite - The einvite token
 * @returns {Promise<Object>} - The created einvite
 */
async function createEinvite(email, einvite) {
  const rows = await queryP('insert into einvites (email, einvite) values ($1, $2) RETURNING *;', [email, einvite]);
  return rows[0];
}

/**
 * Delete an einvite
 * @param {string} einvite - The einvite token
 * @returns {Promise<void>}
 */
async function deleteEinvite(einvite) {
  await queryP('DELETE FROM einvites WHERE einvite = ($1);', [einvite]);
}

/**
 * Validate email
 * @param {string} email - The email to validate
 * @returns {Promise<boolean>} - True if email is already validated
 */
async function isEmailValidated(email) {
  const rows = await queryP_readOnly('select email from email_validations where email = ($1);', [email]);
  return rows.length > 0;
}

/**
 * Add email validation record
 * @param {string} email - The email to validate
 * @returns {Promise<void>}
 */
async function addEmailValidation(email) {
  await queryP('insert into email_validations (email) values ($1);', [email]);
}

export { getEinviteInfo, createEinvite, deleteEinvite, isEmailValidated, addEmailValidation };
