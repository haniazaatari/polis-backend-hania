import {
  createMetadataQuestion,
  createOrUpdateMetadataAnswer,
  deleteMetadataAnswer,
  deleteMetadataQuestionAndAnswers,
  getAllMetadata,
  getChoicesForConversation,
  getMetadataAnswers,
  getMetadataQuestions,
  getZidForAnswer,
  getZidForQuestion
} from '../../db/metadata.js';
import { isConversationOwner, isSuzinviteValid, isZinviteValid } from '../zinvite/zinviteService.js';

/**
 * Get the conversation ID for a metadata answer
 * @param {number} pmaid - Participant metadata answer ID
 * @returns {Promise<number>} - Conversation ID
 */
async function getZidForMetadataAnswer(pmaid) {
  const result = await getZidForAnswer(pmaid);
  if (!result || !result.rows || !result.rows.length) {
    throw new Error('polis_err_get_zid_for_answer');
  }
  return result.rows[0].zid;
}

/**
 * Get the conversation ID for a metadata question
 * @param {number} pmqid - Participant metadata question ID
 * @returns {Promise<number>} - Conversation ID
 */
async function getZidForMetadataQuestion(pmqid) {
  const result = await getZidForQuestion(pmqid);
  if (!result || !result.rows || !result.rows.length) {
    throw new Error('polis_err_get_zid_for_question');
  }
  return result.rows[0].zid;
}

/**
 * Delete a metadata answer
 * @param {number} pmaid - Participant metadata answer ID
 * @returns {Promise<void>}
 */
async function deleteMetadataAnswerById(pmaid) {
  await deleteMetadataAnswer(pmaid);
}

/**
 * Delete a metadata question and its answers
 * @param {number} pmqid - Participant metadata question ID
 * @returns {Promise<void>}
 */
async function deleteMetadataQuestionAndAnswersById(pmqid) {
  await deleteMetadataQuestionAndAnswers(pmqid);
}

/**
 * Check if a user is authorized to delete metadata
 * @param {number} zid - Conversation ID
 * @param {number} uid - User ID
 * @returns {Promise<boolean>} - True if authorized
 */
async function checkDeleteAuthorization(zid, uid) {
  return new Promise((resolve, reject) => {
    isConversationOwner(zid, uid, (err) => {
      if (err) {
        reject(new Error('polis_err_delete_metadata_auth'));
      } else {
        resolve(true);
      }
    });
  });
}

/**
 * Get metadata questions for a conversation
 * @param {number} zid - Conversation ID
 * @returns {Promise<Array>} - Metadata questions
 */
async function getMetadataQuestionsForConversation(zid) {
  const result = await getMetadataQuestions(zid);
  return result.rows.map((r) => {
    r.required = true;
    return r;
  });
}

/**
 * Create a metadata question
 * @param {number} zid - Conversation ID
 * @param {string} key - Question key
 * @returns {Promise<Object>} - Created question
 */
async function createMetadataQuestionForConversation(zid, key) {
  const result = await createMetadataQuestion(zid, key);
  if (!result || !result.rows || !result.rows.length) {
    throw new Error('polis_err_post_participant_metadata_key');
  }
  return result.rows[0];
}

/**
 * Create or update a metadata answer
 * @param {number} pmqid - Participant metadata question ID
 * @param {number} zid - Conversation ID
 * @param {string} value - Answer value
 * @returns {Promise<Object>} - Created or updated answer
 */
async function createOrUpdateMetadataAnswerForQuestion(pmqid, zid, value) {
  try {
    const result = await createOrUpdateMetadataAnswer(pmqid, zid, value);
    if (!result || !result.rows || !result.rows.length) {
      throw new Error('polis_err_post_participant_metadata_value');
    }
    return result.rows[0];
  } catch (error) {
    throw new Error('polis_err_post_participant_metadata_value');
  }
}

/**
 * Get choices for a conversation
 * @param {number} zid - Conversation ID
 * @returns {Promise<Array>} - Choices
 */
async function getChoicesForConversationById(zid) {
  const result = await getChoicesForConversation(zid);
  return result.rows;
}

/**
 * Get metadata answers for a conversation
 * @param {number} zid - Conversation ID
 * @param {number} [pmqid] - Optional question ID to filter by
 * @returns {Promise<Array>} - Metadata answers
 */
async function getMetadataAnswersForConversation(zid, pmqid) {
  const result = await getMetadataAnswers(zid, pmqid);
  return result.rows.map((r) => {
    r.is_exclusive = true;
    return r;
  });
}

/**
 * Get all metadata for a conversation
 * @param {number} zid - Conversation ID
 * @returns {Promise<Object>} - All metadata
 */
async function getAllMetadataForConversation(zid) {
  const { keys, vals, choices } = await getAllMetadata(zid);

  if (!keys || !keys.length) {
    return {};
  }

  const o = {};
  const keyNames = {};
  const valueNames = {};

  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    o[k.pmqid] = {};
    keyNames[k.pmqid] = k.key;
  }

  for (let i = 0; i < vals.length; i++) {
    const v = vals[i];
    o[v.pmqid][v.pmaid] = [];
    valueNames[v.pmaid] = v.value;
  }

  for (let i = 0; i < choices.length; i++) {
    o[choices[i].pmqid][choices[i].pmaid] = choices[i].pid;
  }

  return {
    kvp: o,
    keys: keyNames,
    values: valueNames
  };
}

/**
 * Check if a user has access to metadata
 * @param {number} zid - Conversation ID
 * @param {string} [zinvite] - Optional conversation invite code
 * @param {string} [suzinvite] - Optional single-use invite code
 * @returns {Promise<boolean>} - True if access is allowed
 */
async function checkMetadataAccess(zid, zinvite, suzinvite) {
  try {
    if (zinvite) {
      const isValid = await isZinviteValid(zid, zinvite);
      if (!isValid) {
        throw new Error('polis_err_get_participant_metadata_auth');
      }
      return true;
    }

    if (suzinvite) {
      const isValid = await isSuzinviteValid(zid, suzinvite);
      if (!isValid) {
        throw new Error('polis_err_get_participant_metadata_auth');
      }
      return true;
    }

    return true;
  } catch (_) {
    throw new Error('polis_err_get_participant_metadata_auth');
  }
}

export {
  getZidForMetadataAnswer,
  getZidForMetadataQuestion,
  deleteMetadataAnswerById,
  deleteMetadataQuestionAndAnswersById,
  checkDeleteAuthorization,
  getMetadataQuestionsForConversation,
  createMetadataQuestionForConversation,
  createOrUpdateMetadataAnswerForQuestion,
  getChoicesForConversationById,
  getMetadataAnswersForConversation,
  getAllMetadataForConversation,
  checkMetadataAccess
};
