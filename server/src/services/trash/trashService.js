import { updateConversationModifiedTime } from '../../db/conversationUpdates.js';
import { queryP } from '../../db/pg-query.js';

/**
 * Create a trash record for a comment
 * @param {number} zid - Conversation ID
 * @param {number} tid - Comment ID
 * @param {number} pid - Participant ID
 * @param {boolean} trashed - Whether the comment is trashed
 * @returns {Promise<Object>} - The created trash record
 */
function createTrash(zid, tid, pid, trashed) {
  const query =
    'INSERT INTO trashes (pid, zid, tid, trashed, created) VALUES ($1, $2, $3, $4, default) RETURNING created;';
  const params = [pid, zid, tid, trashed];

  return queryP(query, params).then((result) => {
    const createdTime = result.rows[0].created;

    // Update conversation modified time
    setTimeout(() => {
      updateConversationModifiedTime(zid, createdTime);
    }, 100);

    return result;
  });
}

export { createTrash };
