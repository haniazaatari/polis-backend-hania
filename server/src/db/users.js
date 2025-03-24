import { pgQueryP_readOnly } from './pg-query.js';

/**
 * Get users that should receive moderation emails for a conversation
 * @param {number} zid - The conversation ID
 * @param {number} ownerId - The conversation owner's user ID
 * @returns {Promise<Array>} - Array of user objects
 */
async function getUsersForModerationEmails(zid, ownerId) {
  const users = await pgQueryP_readOnly(
    'SELECT * FROM users WHERE site_id = (SELECT site_id FROM page_ids WHERE zid = $1) UNION SELECT * FROM users WHERE uid = $2;',
    [zid, ownerId]
  );
  return users;
}

export { getUsersForModerationEmails };
