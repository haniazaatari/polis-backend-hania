import Config from '../../config.js';
import { polisFromAddress, sendTextEmail } from '../../email/senders.js';
import logger from '../../utils/logger.js';
import { getUserInfoForUid2 } from '../user/userService.js';

const serverName = Config.getServerNameWithProtocol();

/**
 * Send a verification email
 * This is a direct port of the original sendVerificationEmail function
 * @param {Object} _req - Express request object (unused)
 * @param {string} email - The recipient's email
 * @param {string} einvite - The email verification token
 * @returns {Promise<Object>} - Result of sending the email
 */
function sendVerificationEmail(_req, email, einvite) {
  const body = `Welcome to pol.is!

Click this link to verify your email address:

${serverName}/api/v3/verify?e=${einvite}`;

  return sendTextEmail(polisFromAddress, email, 'Polis verification', body);
}

/**
 * Send password reset email
 * @param {number} uid - User ID
 * @param {string} pwresettoken - Password reset token
 * @returns {Promise<void>}
 * @private
 */
async function sendPasswordResetEmail(uid, pwresettoken) {
  try {
    // Get user info
    const userInfo = await getUserInfoForUid2(uid);

    if (!userInfo) {
      throw new Error('missing user info');
    }

    // Create email body
    const body = `Hi ${userInfo.hname},

We have just received a password reset request for ${userInfo.email}

To reset your password, visit this page:
${serverName}/pwreset/${pwresettoken}

Thank you for using Polis`;

    // Send email
    await sendTextEmail(polisFromAddress, userInfo.email, 'Polis Password Reset', body);
  } catch (error) {
    logger.error('Error sending password reset email', error);
    throw error;
  }
}

/**
 * Send password reset email failure
 * @param {string} email - User email
 * @returns {Promise<void>}
 * @private
 */
async function sendPasswordResetEmailFailure(email) {
  try {
    const body = `We were unable to find a pol.is account registered with the email address: ${email}

You may have used another email address to create your account.

If you need to create a new account, you can do that here ${serverName}/home

Feel free to reply to this email if you need help.`;

    await sendTextEmail(polisFromAddress, email, 'Password Reset Failed', body);
  } catch (error) {
    logger.error('Error sending password reset failure email', error);
    throw error;
  }
}

export { sendVerificationEmail, sendPasswordResetEmail, sendPasswordResetEmailFailure };
