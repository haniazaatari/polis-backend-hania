import { queryP, query_readOnly } from './pg-query.js';
import { sql_participant_metadata_answers } from './sql.js';

/**
 * Get conversation ID for a metadata answer
 * @param {number} pmaid - Participant metadata answer ID
 * @returns {Promise<Array>} Query results
 */
async function getZidForAnswer(pmaid) {
  return await queryP('SELECT zid FROM participant_metadata_answers WHERE pmaid = ($1)', [pmaid]);
}

/**
 * Get conversation ID for a metadata question
 * @param {number} pmqid - Participant metadata question ID
 * @returns {Promise<Array>} Query results
 */
async function getZidForQuestion(pmqid) {
  return await queryP('SELECT zid FROM participant_metadata_questions WHERE pmqid = ($1)', [pmqid]);
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
 * Get metadata questions for a conversation
 * @param {number} zid - Conversation ID
 * @returns {Promise<Array>} Query results
 */
async function getMetadataQuestions(zid) {
  return await queryP('SELECT * FROM participant_metadata_questions WHERE alive = true AND zid = ($1);', [zid]);
}

/**
 * Create a metadata question
 * @param {number} zid - Conversation ID
 * @param {string} key - Question key
 * @returns {Promise<Array>} Query results
 */
async function createMetadataQuestion(zid, key) {
  return await queryP(
    'INSERT INTO participant_metadata_questions (pmqid, zid, key) VALUES (default, $1, $2) RETURNING *;',
    [zid, key]
  );
}

/**
 * Create or update a metadata answer
 * @param {number} pmqid - Participant metadata question ID
 * @param {number} zid - Conversation ID
 * @param {string} value - Answer value
 * @returns {Promise<Array>} Query results
 */
async function createOrUpdateMetadataAnswer(pmqid, zid, value) {
  try {
    return await queryP(
      'INSERT INTO participant_metadata_answers (pmqid, zid, value, pmaid) VALUES ($1, $2, $3, default) RETURNING *;',
      [pmqid, zid, value]
    );
  } catch (_err) {
    return await queryP(
      'UPDATE participant_metadata_answers set alive = TRUE where pmqid = ($1) AND zid = ($2) AND value = ($3) RETURNING *;',
      [pmqid, zid, value]
    );
  }
}

/**
 * Get choices for a conversation
 * @param {number} zid - Conversation ID
 * @returns {Promise<Array>} Query results
 */
async function getChoicesForConversation(zid) {
  return await queryP('SELECT * FROM participant_metadata_choices WHERE zid = ($1);', [zid]);
}

/**
 * Get metadata answers for a conversation
 * @param {number} zid - Conversation ID
 * @param {number} [pmqid] - Optional question ID to filter by
 * @returns {Promise<Array>} Query results
 */
async function getMetadataAnswers(zid, pmqid) {
  let query = sql_participant_metadata_answers
    .select(sql_participant_metadata_answers.star())
    .where(sql_participant_metadata_answers.zid.equals(zid))
    .and(sql_participant_metadata_answers.alive.equals(true));

  if (pmqid) {
    query = query.where(sql_participant_metadata_answers.pmqid.equals(pmqid));
  }

  return await query_readOnly(query.toString());
}

/**
 * Get all metadata for a conversation
 * @param {number} zid - Conversation ID
 * @returns {Promise<Array>} Query results
 */
async function getAllMetadata(zid) {
  const [keysResult, valsResult, choicesResult] = await Promise.all([
    queryP('SELECT * FROM participant_metadata_questions WHERE zid = ($1);', [zid]),
    queryP('SELECT * FROM participant_metadata_answers WHERE zid = ($1);', [zid]),
    queryP('SELECT * FROM participant_metadata_choices WHERE zid = ($1);', [zid])
  ]);

  return {
    keys: keysResult.rows,
    vals: valsResult.rows,
    choices: choicesResult.rows
  };
}

export {
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
};
