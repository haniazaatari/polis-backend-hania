import logger from '../utils/logger.js';
import { queryP } from './pg-query.js';

/**
 * Update the modified time for a conversation
 * @param {number} zid - The conversation ID
 * @param {number} [modified] - Optional custom modified time (milliseconds since epoch)
 * @returns {Promise<void>}
 */
async function updateConversationModifiedTime(zid, modified) {
  try {
    let query;
    let params;

    if (modified !== undefined) {
      // Use the provided timestamp
      query = 'UPDATE conversations SET modified = ($2) WHERE zid = ($1) AND modified < ($2);';
      params = [zid, Number(modified)];
    } else {
      // Use the current time
      query = 'UPDATE conversations SET modified = now_as_millis() WHERE zid = ($1);';
      params = [zid];
    }

    await queryP(query, params);
  } catch (err) {
    logger.error('Error updating conversation modified time', { zid, error: err });
  }
}

/**
 * Update the last interaction time for a user in a conversation
 * @param {number} zid - The conversation ID
 * @param {number} uid - The user ID
 * @returns {Promise<void>}
 */
async function updateLastInteractionTimeForConversation(zid, uid) {
  try {
    await queryP(
      'UPDATE participants SET last_interaction = now_as_millis(), vote_count = vote_count + 1 WHERE zid = ($1) AND uid = ($2);',
      [zid, uid]
    );
  } catch (err) {
    logger.error('Error updating last interaction time', { zid, uid, error: err });
  }
}

/**
 * Update the vote count for a participant
 * @param {number} zid - The conversation ID
 * @param {number} pid - The participant ID
 * @returns {Promise<void>}
 */
async function updateVoteCount(zid, pid) {
  try {
    await queryP('UPDATE participants SET vote_count = vote_count + 1 WHERE zid = ($1) AND pid = ($2);', [zid, pid]);
  } catch (err) {
    logger.error('Error updating vote count', { zid, pid, error: err });
  }
}

export { updateConversationModifiedTime, updateLastInteractionTimeForConversation, updateVoteCount };
