import { pgQueryP_readOnly } from './pg-query.js';

/**
 * Get the participant ID for a user in a conversation
 * @param {number} zid - The conversation ID
 * @param {number} uid - The user ID
 * @param {boolean} [createIfNotExists=false] - Whether to create a participant if one doesn't exist
 * @returns {Promise<number>} - The participant ID or -1 if not found
 */
async function getPidPromise(zid, uid, createIfNotExists = false) {
  // First try to find an existing participant
  const existingParticipant = await pgQueryP_readOnly('SELECT pid FROM participants WHERE zid = $1 AND uid = $2;', [
    zid,
    uid
  ]);

  if (existingParticipant?.length) {
    return existingParticipant[0].pid;
  }

  // If no participant exists and we're not supposed to create one, return -1
  if (!createIfNotExists) {
    return -1;
  }

  // Otherwise, return -1 to signal that a new participant should be created
  return -1;
}

export { getPidPromise };
