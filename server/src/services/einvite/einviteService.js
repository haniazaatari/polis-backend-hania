import {
  addEmailValidation,
  createEinvite,
  getEinviteInfo as dbGetEinviteInfo,
  deleteEinvite,
  isEmailValidated
} from '../../db/einvites.js';
import { sendEinviteEmail } from '../../email/specialized.js';
import logger from '../../utils/logger.js';
import { generateRandomToken } from '../auth/tokenService.js';

/**
 * Get einvite information
 * @param {string} einvite - The einvite token
 * @returns {Promise<Object>} - Einvite info
 * @throws {Error} - If einvite not found
 */
async function getEinviteInfo(einvite) {
  const info = await dbGetEinviteInfo(einvite);
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
    await createEinvite(email, einvite);
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
    const info = await dbGetEinviteInfo(einvite);
    if (!info) {
      throw new Error('polis_err_verification_missing');
    }

    const email = info.email;
    const isValidated = await isEmailValidated(email);

    if (!isValidated) {
      await addEmailValidation(email);
    }

    // Clean up the used einvite
    await deleteEinvite(einvite);
  } catch (error) {
    logger.error('Error verifying email', error);
    throw error;
  }
}

export { getEinviteInfo, sendEmailInvite, verifyEmail }; 