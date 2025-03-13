import Config from '../config.js';
import { pgQueryP_readOnly } from './pg-query.js';

const polisDevs = Config.adminUIDs ? JSON.parse(Config.adminUIDs) : [];

/**
 * Check if a user is a developer (admin)
 * @param {number} uid - The user ID
 * @returns {boolean} - True if the user is a developer
 */
function isPolisDev(uid) {
  return polisDevs.indexOf(uid) >= 0;
}

/**
 * Check if a user is a moderator for a conversation at the database level
 * @param {number} zid - The conversation ID
 * @param {number} uid - The user ID
 * @returns {Promise<boolean>} - True if the user is a moderator
 */
async function isModerator(zid, uid) {
  if (!uid) {
    return false;
  }

  // Check if user is a developer (admin)
  const isDevUser = isPolisDev(uid);
  if (isDevUser) {
    return true;
  }

  // Check if the user is from the same site as the conversation owner
  // This replicates the original query logic
  const rows = await pgQueryP_readOnly(
    'SELECT COUNT(*) FROM conversations WHERE owner IN (SELECT uid FROM users WHERE site_id = (SELECT site_id FROM users WHERE uid = $2)) AND zid = $1;',
    [zid, uid]
  );

  return rows[0].count >= 1;
}

export { isModerator, isPolisDev };
