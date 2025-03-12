import { emailFeatureRequest } from '../../email/senders.js';
import logger from '../../utils/logger.js';

/**
 * Send a feature request email
 * @param {string} message - The feature request message
 * @returns {Promise<void>} - Resolves when the email is sent
 */
function sendFeatureRequest(message) {
  return emailFeatureRequest(message).catch((err) => {
    logger.error('Error sending feature request email', err);
    throw err;
  });
}

export { sendFeatureRequest };
