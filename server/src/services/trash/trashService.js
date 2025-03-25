import { updateConversationModifiedTime } from '../../db/conversationUpdates.js';
import { createTrashRecord } from '../../db/trash.js';

/**
 * Create a trash record for a comment
 * @param {number} zid - Conversation ID
 * @param {number} tid - Comment ID
 * @param {number} pid - Participant ID
 * @param {boolean} trashed - Whether the comment is trashed
 * @returns {Promise<Object>} - The created trash record
 */
function createTrash(zid, tid, pid, trashed) {
  return createTrashRecord(pid, zid, tid, trashed).then((result) => {
    const createdTime = result.rows[0].created;

    // Update conversation modified time
    setTimeout(() => {
      updateConversationModifiedTime(zid, createdTime);
    }, 100);

    return result;
  });
}

export { createTrash };
