import * as db from '../../db/index.js';
import { removeNullOrUndefinedProperties } from '../../utils/common.js';
import logger from '../../utils/logger.js';
import { pullXInfoIntoSubObjects } from '../../utils/participants.js';

/**
 * Get participants with moderation status for a conversation
 * @param {number} zid - Conversation ID
 * @param {number|undefined} mod - Moderation status filter (optional)
 * @param {number} uid - User ID of the requester
 * @param {string} conversationId - Conversation ID string
 * @returns {Promise<Array>} - Array of participants with moderation status
 */
async function getParticipantsWithModerationStatus(zid, mod, uid, conversationId) {
  try {
    // Get conversation info to check permissions
    const conversation = await db.getConversationInfo(zid);

    // Get participants with social info and moderation status
    const participants = await db.getSocialParticipantsForMod(
      zid,
      99999, // Limit set to a high number as in original code
      mod,
      conversation.owner
    );

    // Check if user is allowed to see the data
    const isOwner = uid === conversation.owner;
    const isPolisDev = await db.isPolisDev(uid);
    const isAllowed = isOwner || isPolisDev || conversation.is_data_open;

    if (!isAllowed) {
      return [];
    }

    // Process participants data
    return participants
      .map(pullXInfoIntoSubObjects)
      .map(removeNullOrUndefinedProperties)
      .map((p) => {
        p.conversation_id = conversationId;
        return p;
      });
  } catch (error) {
    logger.error('Error getting participants with moderation status', error);
    throw error;
  }
}

/**
 * Update participant moderation status
 * @param {number} zid - Conversation ID
 * @param {number} uid - User ID of the requester
 * @param {number} pid - Participant ID to update
 * @param {number} mod - New moderation status
 * @returns {Promise<void>}
 */
async function updateParticipantModerationStatus(zid, uid, pid, mod) {
  try {
    // Check if user is a moderator
    const isMod = await db.isModerator(zid, uid);

    if (!isMod) {
      const error = new Error('User is not a moderator');
      error.status = 403;
      error.code = 'polis_err_ptptoi_permissions_123';
      throw error;
    }

    // Update participant moderation status
    await db.updateParticipantModerationStatus(zid, pid, mod);
  } catch (error) {
    logger.error('Error updating participant moderation status', error);
    throw error;
  }
}

export { getParticipantsWithModerationStatus, updateParticipantModerationStatus };
