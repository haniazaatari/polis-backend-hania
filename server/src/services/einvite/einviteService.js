import { sendEinviteEmail } from '../../email/specialized.js';
import {
  checkEmailValidation,
  createNewEinvite,
  getEinviteById,
  removeEinvite,
  validateEmail
} from '../../repositories/einvite/einviteRepository.js';
import logger from '../../utils/logger.js';
import { generateRandomToken } from '../auth/tokenService.js';

/**
 * Get einvite information
 * @param {string} einvite - The einvite token
 * @returns {Promise<Object>} - Einvite info
 * @throws {Error} - If einvite not found
 */
async function getEinviteInfo(einvite) {
  const info = await getEinviteById(einvite);
  if (!info) {
    throw new Error('polis_err_missing_einvite');
  }
  return info;
}

/**
 * Send an email invite
 * @param {string} email - The recipient's email
 * @returns {Promise<void>}
 */
async function sendEmailInvite(email) {
  try {
    const einvite = await generateRandomToken(30, false);
    await createNewEinvite(email, einvite);
    await sendEinviteEmail(email, einvite);
  } catch (error) {
    logger.error('Error sending email invite', error);
    throw error;
  }
}

/**
 * Verify an email address
 * @param {string} einvite - The einvite token
 * @returns {Promise<void>}
 * @throws {Error} - If verification fails
 */
async function verifyEmail(einvite) {
  try {
    const info = await getEinviteById(einvite);
    if (!info) {
      throw new Error('polis_err_verification_missing');
    }

    const email = info.email;
    const isValidated = await checkEmailValidation(email);

    if (!isValidated) {
      await validateEmail(email);
    }

    // Clean up the used einvite
    await removeEinvite(einvite);
  } catch (error) {
    logger.error('Error verifying email', error);
    throw error;
  }
}

export { getEinviteInfo, sendEmailInvite, verifyEmail }; 