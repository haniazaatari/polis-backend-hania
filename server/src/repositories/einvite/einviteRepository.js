import {
  addEmailValidation,
  createEinvite,
  deleteEinvite,
  getEinviteInfo,
  isEmailValidated
} from '../../db/einvites.js';
import logger from '../../utils/logger.js';

/**
 * Get einvite information
 * @param {string} einvite - The einvite token
 * @returns {Promise<Object|null>} - Einvite info or null if not found
 */
async function getEinviteById(einvite) {
  try {
    return await getEinviteInfo(einvite);
  } catch (error) {
    logger.error('Error getting einvite info', error);
    throw error;
  }
}

/**
 * Create a new einvite
 * @param {string} email - The recipient's email
 * @param {string} einvite - The einvite token
 * @returns {Promise<Object>} - The created einvite
 */
async function createNewEinvite(email, einvite) {
  try {
    return await createEinvite(email, einvite);
  } catch (error) {
    logger.error('Error creating einvite', error);
    throw error;
  }
}

/**
 * Delete an einvite
 * @param {string} einvite - The einvite token
 * @returns {Promise<void>}
 */
async function removeEinvite(einvite) {
  try {
    await deleteEinvite(einvite);
  } catch (error) {
    logger.error('Error deleting einvite', error);
    throw error;
  }
}

/**
 * Check if email is validated
 * @param {string} email - The email to check
 * @returns {Promise<boolean>} - True if email is validated
 */
async function checkEmailValidation(email) {
  try {
    return await isEmailValidated(email);
  } catch (error) {
    logger.error('Error checking email validation', error);
    throw error;
  }
}

/**
 * Validate an email address
 * @param {string} email - The email to validate
 * @returns {Promise<void>}
 */
async function validateEmail(email) {
  try {
    await addEmailValidation(email);
  } catch (error) {
    logger.error('Error validating email', error);
    throw error;
  }
}

export {
  getEinviteById,
  createNewEinvite,
  removeEinvite,
  checkEmailValidation,
  validateEmail
}; 