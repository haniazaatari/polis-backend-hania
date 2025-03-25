import {
  getSocialParticipantsForMod as dbGetSocialParticipantsForMod,
  updateParticipantModerationStatus as dbUpdateParticipantModerationStatus
} from '../../db/participantModeration.js';

/**
 * Get social participants for moderation
 * @param {number} zid - Conversation ID
 * @param {number} limit - Maximum number of participants to return
 * @param {number|undefined} mod - Moderation status filter (optional)
 * @param {number} owner - User ID of the conversation owner
 * @returns {Promise<Array>} - Array of participants with social info
 */
async function getSocialParticipantsForMod(zid, limit, mod, owner) {
  return dbGetSocialParticipantsForMod(zid, limit, mod, owner);
}

/**
 * Update participant moderation status
 * @param {number} zid - Conversation ID
 * @param {number} pid - Participant ID
 * @param {number} mod - New moderation status
 * @returns {Promise<void>}
 */
async function updateParticipantModerationStatus(zid, pid, mod) {
  return dbUpdateParticipantModerationStatus(zid, pid, mod);
}

export { getSocialParticipantsForMod, updateParticipantModerationStatus };
