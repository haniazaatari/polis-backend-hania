import { pgQueryP_readOnly } from './pg-query.js';

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

  const rows = await pgQueryP_readOnly('SELECT * FROM conversations WHERE zid = $1 AND owner = $2;', [zid, uid]);

  if (rows?.length) {
    return true;
  }

  const moderatorRows = await pgQueryP_readOnly('SELECT * FROM moderators WHERE zid = $1 AND uid = $2;', [zid, uid]);

  return moderatorRows?.length > 0;
}

export { isModerator };
