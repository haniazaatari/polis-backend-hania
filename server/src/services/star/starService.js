import { updateConversationModifiedTime } from '../../db/conversationUpdates.js';
import { addStar } from '../../db/stars.js';

/**
 * Create a star for a comment
 * @param {number} zid - Conversation ID
 * @param {number} tid - Comment ID
 * @param {number} pid - Participant ID
 * @param {boolean} starred - Whether the comment is starred
 * @returns {Promise<Object>} - The created star
 */
function createStar(zid, tid, pid, starred) {
  return addStar(zid, tid, pid, starred).then((result) => {
    const createdTime = result.rows[0].created;

    // Update conversation modified time
    setTimeout(() => {
      updateConversationModifiedTime(zid, createdTime);
    }, 100);

    return result;
  });
}

export { createStar };
