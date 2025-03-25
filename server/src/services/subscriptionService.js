import { subscribeToNotifications, unsubscribeFromNotifications } from '../../email/notifications.js';
import logger from '../../utils/logger.js';

/**
 * Subscribe a user to a conversation
 * @param {number} zid - The conversation ID
 * @param {number} uid - The user ID
 * @param {string} email - The user's email
 * @returns {Promise<number>} - The subscription type (1 for subscribed)
 */
function subscribeToConversation(zid, uid, email) {
  logger.info('subscribeToConversation', { zid, uid });
  return subscribeToNotifications(zid, uid, email);
}

/**
 * Unsubscribe a user from a conversation
 * @param {number} zid - The conversation ID
 * @param {number} uid - The user ID
 * @returns {Promise<number>} - The subscription type (0 for unsubscribed)
 */
function unsubscribeFromConversation(zid, uid) {
  logger.info('unsubscribeFromConversation', { zid, uid });
  return unsubscribeFromNotifications(zid, uid);
}

export { subscribeToConversation, unsubscribeFromConversation };
