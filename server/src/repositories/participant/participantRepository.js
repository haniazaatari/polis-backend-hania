/**
 * Participant Repository
 * Handles database operations related to participants
 */
import LruCache from 'lru-cache';
import { queryP, queryP_readOnly } from '../../db/pg-query.js';
import logger from '../../utils/logger.js';

// Cache for participant IDs
const pidCache = new LruCache({
  max: 9000,
  ttl: 1000 * 60 * 5 // 5 minutes
});

/**
 * Get participant ID for a user in a conversation
 * @param {number} zid - Conversation ID
 * @param {number} uid - User ID
 * @param {boolean} [usePrimary=false] - Whether to use primary database
 * @returns {Promise<number>} - Participant ID or -1 if not found
 */
async function getParticipantId(zid, uid, usePrimary = false) {
  const cacheKey = `${zid}_${uid}`;
  const cachedPid = pidCache.get(cacheKey);

  if (cachedPid !== undefined) {
    return cachedPid;
  }

  try {
    const f = usePrimary ? queryP : queryP_readOnly;
    const results = await f('SELECT pid FROM participants WHERE zid = ($1) AND uid = ($2);', [zid, uid]);

    if (!results || !results.length) {
      return -1;
    }

    const pid = results[0].pid;
    pidCache.set(cacheKey, pid);
    return pid;
  } catch (error) {
    logger.error('Error getting participant ID', { error, zid, uid });
    throw error;
  }
}

/**
 * Get participant by external ID in a conversation
 * @param {string} xid - External ID
 * @param {number} zid - Conversation ID
 * @returns {Promise<Object|string>} - Participant record or error message
 */
async function getParticipantByXid(xid, zid) {
  try {
    const results = await queryP_readOnly('SELECT * FROM xids WHERE xid = ($1) AND zid = ($2);', [xid, zid]);

    if (!results || !results.length) {
      return 'noXidRecord';
    }

    const xidRecord = results[0];
    const pid = await getParticipantId(zid, xidRecord.uid, true);

    return {
      ...xidRecord,
      pid
    };
  } catch (error) {
    logger.error('Error getting participant by XID', { error, xid, zid });
    throw error;
  }
}

/**
 * Get a participant by ID
 * @param {number} pid - Participant ID
 * @returns {Promise<Object|null>} - Participant object or null if not found
 */
async function getParticipantByPid(pid) {
  try {
    const rows = await queryP_readOnly('SELECT * FROM participants WHERE pid = ($1);', [pid]);
    return rows.length ? rows[0] : null;
  } catch (error) {
    logger.error('Error getting participant by PID', { error, pid });
    throw error;
  }
}

/**
 * Get a participant by user ID and conversation ID
 * @param {number} zid - Conversation ID
 * @param {number} uid - User ID
 * @returns {Promise<Object|null>} - Participant object or null if not found
 */
async function getParticipantByUid(zid, uid) {
  try {
    const rows = await queryP_readOnly('SELECT * FROM participants WHERE zid = ($1) AND uid = ($2);', [zid, uid]);
    return rows.length ? rows[0] : null;
  } catch (error) {
    logger.error('Error getting participant by UID', { error, zid, uid });
    throw error;
  }
}

/**
 * Get answers for a conversation
 * @param {number} zid - Conversation ID
 * @returns {Promise<Array>} - Array of answers
 */
async function getAnswersForConversation(zid) {
  try {
    const rows = await queryP('SELECT * FROM participant_metadata_answers WHERE zid = ($1) AND alive = TRUE;', [zid]);
    return rows;
  } catch (error) {
    logger.error('Error getting answers for conversation', { error, zid });
    throw error;
  }
}

/**
 * Check if a user has answered the required questions for a conversation
 * @param {number} zid - Conversation ID
 * @param {Array} answers - Array of answer IDs
 * @returns {Promise<boolean>} - Whether the user has answered the required questions
 * @throws {Error} - If required questions are not answered
 */
async function userHasAnsweredZeQuestions(zid, answers) {
  try {
    // If no answers provided, return true (no questions to answer)
    if (!answers || !answers.length) {
      return true;
    }

    // Get all available answers for the conversation
    const available_answers = await getAnswersForConversation(zid);

    // Create indexes for quick lookup
    const q2a = {}; // Question ID to Answer mapping
    const a2q = {}; // Answer ID to Question mapping

    // Build the indexes
    for (const answer of available_answers) {
      q2a[answer.pmqid] = answer;
      a2q[answer.pmaid] = answer;
    }

    // Check if all required questions have been answered
    for (let i = 0; i < answers.length; i++) {
      const answer = a2q[answers[i]];
      if (!answer) continue;

      const pmqid = answer.pmqid;
      delete q2a[pmqid];
    }

    // Check if any required questions remain unanswered
    const remainingKeys = Object.keys(q2a);
    const missing = remainingKeys && remainingKeys.length > 0;

    if (missing) {
      throw new Error(`polis_err_metadata_not_chosen_pmqid_${remainingKeys[0]}`);
    }

    return true;
  } catch (error) {
    logger.error('Error checking if user has answered required questions', { error, zid });
    throw error;
  }
}

/**
 * Create a new participant
 * @param {number} zid - Conversation ID
 * @param {number} uid - User ID
 * @returns {Promise<Object>} - The created participant
 */
async function createParticipant(zid, uid) {
  try {
    const result = await queryP('INSERT INTO participants (zid, uid) VALUES ($1, $2) RETURNING *;', [zid, uid]);
    return result[0];
  } catch (error) {
    logger.error('Error creating participant', { error, zid, uid });
    throw error;
  }
}

/**
 * Add extended participant info
 * @param {number} zid - Conversation ID
 * @param {number} uid - User ID
 * @param {Object} info - Extended participant info
 * @returns {Promise<void>}
 */
async function addExtendedParticipantInfo(zid, uid, info) {
  if (!info || !Object.keys(info).length) {
    return;
  }

  try {
    const infoFields = [];
    const infoValues = [];
    let paramNum = 3;

    for (const key in info) {
      infoFields.push(`${key} = ($${paramNum})`);
      infoValues.push(info[key]);
      paramNum++;
    }

    await queryP(`UPDATE participants SET ${infoFields.join(', ')} WHERE zid = ($1) AND uid = ($2);`, [
      zid,
      uid,
      ...infoValues
    ]);
  } catch (error) {
    logger.error('Error adding extended participant info', { error, zid, uid });
    // Don't rethrow - the legacy code doesn't propagate this error
  }
}

/**
 * Save participant metadata choices
 * @param {number} zid - Conversation ID
 * @param {number} pid - Participant ID
 * @param {Array|Object} answers - Answers to participant metadata questions
 * @returns {Promise<void>}
 */
async function saveParticipantMetadataChoices(zid, pid, answers) {
  if (!answers || (Array.isArray(answers) ? !answers.length : !Object.keys(answers).length)) {
    return;
  }

  try {
    // Handle both array and object formats for answers
    const answersArray = Array.isArray(answers) ? answers : Object.keys(answers).map((pmqid) => answers[pmqid]);

    for (const answer of answersArray) {
      await queryP(
        'INSERT INTO participant_metadata_answers (zid, pid, pmqid, answer) VALUES ($1, $2, $3, $4) ON CONFLICT (zid, pid, pmqid) DO UPDATE SET answer = $4;',
        [zid, pid, answer.pmqid || answer, answer.value || answer]
      );
    }
  } catch (error) {
    logger.error('Error saving participant metadata choices', { error, zid, pid });
    // Don't rethrow - the legacy code doesn't propagate this error
  }
}

/**
 * Join a conversation as a participant
 * @param {number} zid - Conversation ID
 * @param {number} uid - User ID
 * @param {Object} info - Additional information about the participant
 * @param {Array|Object} answers - Answers to participant metadata questions
 * @returns {Promise<Object>} - Participant object
 */
async function tryToJoinConversation(zid, uid, info, answers) {
  try {
    // Add the participant
    const ptpt = await createParticipant(zid, uid);

    // Add extended participant info if provided (as a separate operation)
    if (info && Object.keys(info).length > 0) {
      // Don't await this - the legacy code doesn't wait for it to complete
      addExtendedParticipantInfo(zid, uid, info);
    }

    // Save metadata answers if provided (as a separate operation)
    if (answers && (Array.isArray(answers) ? answers.length : Object.keys(answers).length) > 0) {
      // Don't await this - the legacy code doesn't wait for it to complete
      saveParticipantMetadataChoices(zid, ptpt.pid, answers);
    }

    // Return the full participant object
    return ptpt;
  } catch (error) {
    logger.error('Error joining conversation', { error, zid, uid });
    throw error;
  }
}

export {
  addExtendedParticipantInfo,
  createParticipant,
  getAnswersForConversation,
  getParticipantByPid,
  getParticipantByUid,
  getParticipantByXid,
  getParticipantId,
  pidCache,
  saveParticipantMetadataChoices,
  tryToJoinConversation,
  userHasAnsweredZeQuestions
};
