import logger from '../utils/logger.js';
import { queryP } from './pg-query.js';

/**
 * Create a notification task in the database
 * @param {number} zid - The conversation ID
 * @returns {Promise<void>}
 */
async function createNotificationTask(zid) {
  try {
    await queryP(
      'INSERT INTO notification_tasks (zid) VALUES ($1) ON CONFLICT (zid) DO UPDATE SET modified = now_as_millis();',
      [zid]
    );
  } catch (err) {
    logger.error('Error creating notification task in database', { zid, error: err });
  }
}

/**
 * Update participant's notification subscription status
 * @param {number} zid - The conversation ID
 * @param {string} email - The participant's email
 * @param {boolean} subscribed - Whether to subscribe (true) or unsubscribe (false)
 * @returns {Promise<void>}
 */
async function updateSubscription(zid, email, subscribed) {
  try {
    await queryP(
      'update participants set subscribed = ($3) where uid = (select uid from users where email = ($2)) and zid = ($1);',
      [zid, email, subscribed ? 1 : 0]
    );
  } catch (err) {
    logger.error('Error updating notification subscription', { zid, email, subscribed, error: err });
    throw err;
  }
}

export { createNotificationTask, updateSubscription };
