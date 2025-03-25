import { queryP } from './pg-query.js';

/**
 * Create a trash record for a comment
 * @param {number} pid - Participant ID
 * @param {number} zid - Conversation ID
 * @param {number} tid - Comment ID
 * @param {boolean} trashed - Whether the comment is trashed
 * @returns {Promise<Object>} - The created trash record
 */
async function createTrashRecord(pid, zid, tid, trashed) {
  const query =
    'INSERT INTO trashes (pid, zid, tid, trashed, created) VALUES ($1, $2, $3, $4, default) RETURNING created;';
  const params = [pid, zid, tid, trashed];

  return await queryP(query, params);
}

export { createTrashRecord };
