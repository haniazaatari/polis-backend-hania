import logger from '../utils/logger.js';
import { pgQueryP } from './pg-query.js';

/**
 * Create a notification task in the database
 * @param {number} zid - The conversation ID
 * @returns {Promise<void>}
 */
async function createNotificationTask(zid) {
  try {
    await pgQueryP(
      'INSERT INTO notification_tasks (zid) VALUES ($1) ON CONFLICT (zid) DO UPDATE SET modified = now_as_millis();',
      [zid]
    );
  } catch (err) {
    logger.error('Error creating notification task in database', { zid, error: err });
  }
}

export { createNotificationTask };
