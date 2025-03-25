import logger from '../utils/logger.js';
import { queryP, queryP_readOnly } from './pg-query.js';

/**
 * Get demographic questions for a conversation
 * @param {number} zid - Conversation ID
 * @returns {Promise<Array>} Array of demographic questions
 */
async function getDemographicQuestions(zid) {
  const rows = await queryP_readOnly('SELECT * FROM demographic_questions WHERE zid = ($1) ORDER BY priority;', [zid]);
  return rows;
}

/**
 * Get demographic answers for a conversation
 * @param {number} zid - Conversation ID
 * @returns {Promise<Array>} Array of demographic answers
 */
async function getDemographicAnswers(zid) {
  const rows = await queryP_readOnly('SELECT * FROM demographic_answers WHERE zid = ($1);', [zid]);
  return rows;
}

/**
 * Create a demographic question
 * @param {Object} params - Question parameters
 * @param {number} params.zid - Conversation ID
 * @param {string} params.key - Question key
 * @param {string} params.text - Question text
 * @param {number} params.priority - Question priority
 * @returns {Promise<Object>} Created question
 */
async function createDemographicQuestion({ zid, key, text, priority }) {
  try {
    const rows = await queryP(
      'INSERT INTO demographic_questions (zid, key, text, priority) VALUES ($1, $2, $3, $4) RETURNING *;',
      [zid, key, text, priority]
    );
    return rows[0];
  } catch (error) {
    logger.error('Error creating demographic question:', error);
    throw error;
  }
}

/**
 * Create a demographic answer
 * @param {Object} params - Answer parameters
 * @param {number} params.zid - Conversation ID
 * @param {number} params.pid - Participant ID
 * @param {string} params.key - Question key
 * @param {string} params.value - Answer value
 * @returns {Promise<Object>} Created answer
 */
async function createDemographicAnswer({ zid, pid, key, value }) {
  try {
    const rows = await queryP(
      'INSERT INTO demographic_answers (zid, pid, key, value) VALUES ($1, $2, $3, $4) RETURNING *;',
      [zid, pid, key, value]
    );
    return rows[0];
  } catch (error) {
    logger.error('Error creating demographic answer:', error);
    throw error;
  }
}

export { getDemographicQuestions, getDemographicAnswers, createDemographicQuestion, createDemographicAnswer };
