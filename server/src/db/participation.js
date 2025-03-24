import { queryP_readOnly } from './pg-query.js';

/**
 * Get vote counts for a conversation
 * @param {number} zid - Conversation ID
 * @returns {Promise<Array>} Query results
 */
async function getVoteCounts(zid) {
  return await queryP_readOnly('select pid, count(*) from votes where zid = ($1) group by pid;', [zid]);
}

/**
 * Get comment counts for a conversation
 * @param {number} zid - Conversation ID
 * @returns {Promise<Array>} Query results
 */
async function getCommentCounts(zid) {
  return await queryP_readOnly('select pid, count(*) from comments where zid = ($1) group by pid;', [zid]);
}

export { getVoteCounts, getCommentCounts };
