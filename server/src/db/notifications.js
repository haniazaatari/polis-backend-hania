import logger from '../utils/logger.js';
import { pgQueryP } from './pg-query.js';

/**
 * Create a notification task in the database
 * @param {number} zid - The conversation ID
 * @param {string} taskType - The type of notification task
 * @param {number} scheduledTime - The time when the notification should be sent (milliseconds)
 * @returns {Promise<void>}
 */
async function createNotificationTask(zid, taskType = 'new_comments', scheduledTime = null) {
  try {
    // If no scheduled time is provided, default to 10 minutes from now
    const notificationTime = scheduledTime || Date.now() + 10 * 60 * 1000;

    await pgQueryP(
      'INSERT INTO notification_tasks (zid, task_type, scheduled_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING;',
      [zid, taskType, notificationTime]
    );
  } catch (err) {
    logger.error('Error creating notification task in database', { zid, taskType, error: err });
  }
}

export { createNotificationTask };
