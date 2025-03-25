/**
 * Participant Repository
 * Handles complex database operations related to participants
 */
import * as db from '../db/index.js';
import logger from '../utils/logger.js';

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
    const available_answers = await db.getAnswersForConversation(zid);

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
 * Join a conversation as a participant with metadata
 * Complex operation that creates participant and handles metadata
 * @param {number} zid - Conversation ID
 * @param {number} uid - User ID
 * @param {Object} info - Additional information about the participant
 * @param {Array|Object} answers - Answers to participant metadata questions
 * @returns {Promise<Object>} - Participant object
 */
async function tryToJoinConversation(zid, uid, info, answers) {
  try {
    // Add the participant
    const [ptpt] = await db.addParticipant(zid, uid);

    // Add extended participant info if provided (as a separate operation)
    if (info && Object.keys(info).length > 0) {
      // Don't await this - the legacy code doesn't wait for it to complete
      db.updateExtendedParticipantInfo(zid, uid, info);
    }

    // Save metadata answers if provided (as a separate operation)
    if (answers && (Array.isArray(answers) ? answers.length : Object.keys(answers).length) > 0) {
      // Don't await this - the legacy code doesn't wait for it to complete
      db.saveParticipantMetadataChoices(zid, ptpt.pid, answers);
    }

    // Return the full participant object
    return ptpt;
  } catch (error) {
    logger.error('Error joining conversation', { error, zid, uid });
    throw error;
  }
}

export { tryToJoinConversation, userHasAnsweredZeQuestions };
