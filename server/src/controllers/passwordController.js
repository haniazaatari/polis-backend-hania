import * as cookieService from '../services/auth/cookieService.js';
import { updatePassword } from '../services/auth/passwordService.js';
import * as tokenService from '../services/auth/tokenService.js';
import { sendPasswordResetEmail, sendPasswordResetEmailFailure } from '../services/email/emailService.js';
import * as userService from '../services/user/userService.js';
import logger from '../utils/logger.js';
import { fail } from '../utils/responseHandlers.js';

/**
 * Handle password reset request
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handlePasswordReset(req, res) {
  const pwresettoken = req.p.pwresettoken;
  const newPassword = req.p.newPassword;

  try {
    // Get user ID for token
    const uid = await tokenService.getUserIdForPasswordResetToken(pwresettoken);

    if (!uid) {
      fail(res, 500, "Password Reset failed. Couldn't find matching pwresettoken.");
      return;
    }

    // Update password - no need to pre-hash as updatePassword handles hashing
    await updatePassword(uid, newPassword);

    // Clear token
    await tokenService.clearPasswordResetToken(pwresettoken);

    res.status(200).json('Password reset successful.');
  } catch (err) {
    fail(res, 500, "Password Reset failed. Couldn't reset password.", err);
  }
}

/**
 * Handle password reset token request
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handlePasswordResetToken(req, res) {
  const email = req.p.email;

  // Clear cookies
  cookieService.clearCookies(req, res);

  try {
    // Get user ID by email
    const uid = await getUserIdByEmail(email);

    // Create password reset token
    const pwresettoken = await tokenService.createPasswordResetToken(uid);

    // Send password reset email
    await sendPasswordResetEmail(uid, pwresettoken);

    res.status(200).json('Password reset email sent, please check your email.');
  } catch (err) {
    // If user not found, send failure email but return success response
    if (err.message === 'polis_err_no_user_matching_email') {
      await sendPasswordResetEmailFailure(email);
      res.status(200).json('Password reset email sent, please check your email.');
    } else {
      fail(res, 500, "Error: Couldn't process password reset request.", err);
    }
  }
}

/**
 * Get user ID by email
 * @param {string} email - User email
 * @returns {Promise<number>} - User ID
 * @private
 */
async function getUserIdByEmail(email) {
  try {
    const lowerEmail = email.toLowerCase();
    const user = await userService.getUserByEmail(lowerEmail);

    if (!user) {
      throw new Error('polis_err_no_user_matching_email');
    }

    return user.uid;
  } catch (error) {
    logger.error('Error getting user ID by email', error);
    throw error;
  }
}

export { handlePasswordReset, handlePasswordResetToken };
