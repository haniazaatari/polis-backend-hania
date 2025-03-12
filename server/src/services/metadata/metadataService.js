import { queryP, query_readOnly } from '../../db/pg-query.js';
import { sql_participant_metadata_answers } from '../../db/sql.js';
import { isConversationOwner, isSuzinviteValid, isZinviteValid } from '../zinvite/zinviteService.js';

/**
 * Get the conversation ID for a metadata answer
 * @param {number} pmaid - Participant metadata answer ID
 * @returns {Promise<number>} - Conversation ID
 */
async function getZidForAnswer(pmaid) {
  const result = await queryP('SELECT zid FROM participant_metadata_answers WHERE pmaid = ($1)', [pmaid]);
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
async function getZidForQuestion(pmqid) {
  const result = await queryP('SELECT zid FROM participant_metadata_questions WHERE pmqid = ($1)', [pmqid]);
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
async function deleteMetadataAnswer(pmaid) {
  await queryP('UPDATE participant_metadata_answers SET alive = FALSE WHERE pmaid = ($1)', [pmaid]);
}

/**
 * Delete a metadata question and its answers
 * @param {number} pmqid - Participant metadata question ID
 * @returns {Promise<void>}
 */
async function deleteMetadataQuestionAndAnswers(pmqid) {
  await queryP('UPDATE participant_metadata_questions SET alive = FALSE WHERE pmqid = ($1)', [pmqid]);
  await queryP('UPDATE participant_metadata_answers SET alive = FALSE WHERE pmqid = ($1)', [pmqid]);
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
async function getMetadataQuestions(zid) {
  const result = await queryP('SELECT * FROM participant_metadata_questions WHERE alive = true AND zid = ($1);', [zid]);
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
async function createMetadataQuestion(zid, key) {
  const result = await queryP(
    'INSERT INTO participant_metadata_questions (pmqid, zid, key) VALUES (default, $1, $2) RETURNING *;',
    [zid, key]
  );
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
async function createOrUpdateMetadataAnswer(pmqid, zid, value) {
  try {
    const result = await queryP(
      'INSERT INTO participant_metadata_answers (pmqid, zid, value, pmaid) VALUES ($1, $2, $3, default) RETURNING *;',
      [pmqid, zid, value]
    );
    return result.rows[0];
  } catch (_err) {
    // If insert fails, try to update
    const updateResult = await queryP(
      'UPDATE participant_metadata_answers set alive = TRUE where pmqid = ($1) AND zid = ($2) AND value = ($3) RETURNING *;',
      [pmqid, zid, value]
    );
    if (!updateResult || !updateResult.rows || !updateResult.rows.length) {
      throw new Error('polis_err_post_participant_metadata_value');
    }
    return updateResult.rows[0];
  }
}

/**
 * Get choices for a conversation
 * @param {number} zid - Conversation ID
 * @returns {Promise<Array>} - Choices
 */
async function getChoicesForConversation(zid) {
  const result = await queryP('SELECT * FROM participant_metadata_choices WHERE zid = ($1);', [zid]);
  return result.rows;
}

/**
 * Get metadata answers for a conversation
 * @param {number} zid - Conversation ID
 * @param {number} [pmqid] - Optional question ID to filter by
 * @returns {Promise<Array>} - Metadata answers
 */
async function getMetadataAnswers(zid, pmqid) {
  let query = sql_participant_metadata_answers
    .select(sql_participant_metadata_answers.star())
    .where(sql_participant_metadata_answers.zid.equals(zid))
    .and(sql_participant_metadata_answers.alive.equals(true));

  if (pmqid) {
    query = query.where(sql_participant_metadata_answers.pmqid.equals(pmqid));
  }

  const result = await query_readOnly(query.toString());
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
async function getAllMetadata(zid) {
  const [keysResult, valsResult, choicesResult] = await Promise.all([
    queryP('SELECT * FROM participant_metadata_questions WHERE zid = ($1);', [zid]),
    queryP('SELECT * FROM participant_metadata_answers WHERE zid = ($1);', [zid]),
    queryP('SELECT * FROM participant_metadata_choices WHERE zid = ($1);', [zid])
  ]);

  const keys = keysResult.rows;
  const vals = valsResult.rows;
  const choices = choicesResult.rows;

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
  getZidForAnswer,
  getZidForQuestion,
  deleteMetadataAnswer,
  deleteMetadataQuestionAndAnswers,
  checkDeleteAuthorization,
  getMetadataQuestions,
  createMetadataQuestion,
  createOrUpdateMetadataAnswer,
  getChoicesForConversation,
  getMetadataAnswers,
  getAllMetadata,
  checkMetadataAccess
};
