import { isXidWhitelisted } from '../repositories/xid/xidRepository.js';
import { isDuplicateKey } from '../utils/common.js';
import logger from '../utils/logger.js';
import { queryP, query_readOnly } from './pg-query.js';

/**
 * Insert a vote into the database
 * @param {number} _uid - User ID
 * @param {number} pid - Participant ID
 * @param {object} conv - Conversation object
 * @param {number} tid - Comment ID
 * @param {number} vote - Vote value (-1, 0, 1)
 * @param {number} weight - Vote weight
 * @param {boolean} high_priority - Whether the vote is high priority
 * @returns {Promise<Object>} - The vote result
 */
async function doVotesPost(_uid, pid, conv, tid, vote, weight, high_priority) {
  return new Promise((resolve, reject) => {
    const zid = conv?.zid;
    const effectiveWeight = weight || 0;
    const weight_x_32767 = Math.trunc(effectiveWeight * 32767);

    const query =
      'INSERT INTO votes (pid, zid, tid, vote, weight_x_32767, high_priority, created) VALUES ($1, $2, $3, $4, $5, $6, default) RETURNING *;';
    const params = [pid, zid, tid, vote, weight_x_32767, high_priority];

    queryP(query, params, (err, result) => {
      if (err) {
        if (isDuplicateKey(err)) {
          reject('polis_err_vote_duplicate');
        } else {
          logger.error('polis_err_vote_other', err);
          reject('polis_err_vote_other');
        }
        return;
      }

      const vote = result.rows[0];
      resolve({
        conv: conv,
        vote: vote
      });
    });
  });
}

/**
 * Create a new vote
 * @param {number} uid - The user ID
 * @param {number} pid - The participant ID
 * @param {number} zid - The conversation ID
 * @param {number} tid - The comment ID
 * @param {string|null} xid - The external ID
 * @param {number} vote - The vote value (-1, 0, 1)
 * @param {number} weight - The vote weight
 * @param {boolean} high_priority - Whether the vote is high priority
 * @returns {Promise<Object>} - The vote result
 */
async function votesPost(uid, pid, zid, tid, xid, vote, weight, high_priority) {
  try {
    // Validate required parameters
    if (pid === undefined || pid === null || pid < 0) {
      throw 'polis_err_param_pid_invalid';
    }

    if (tid === undefined || tid === null || tid < 0) {
      throw 'polis_err_param_tid_invalid';
    }

    // Check if the conversation exists and is active
    const rows = await query_readOnly('SELECT * FROM conversations WHERE zid = ($1);', [zid]);

    if (!rows || !rows.length) {
      throw 'polis_err_unknown_conversation';
    }

    const conv = rows[0];

    if (!conv.is_active) {
      throw 'polis_err_conversation_is_closed';
    }

    // Check if the XID is whitelisted if required
    if (conv.use_xid_whitelist) {
      const is_whitelisted = await isXidWhitelisted(conv.owner, xid);

      if (!is_whitelisted) {
        throw 'polis_err_xid_not_whitelisted';
      }
    }

    // Insert the vote
    return doVotesPost(uid, pid, conv, tid, vote, weight, high_priority);
  } catch (err) {
    logger.error('Error in votesPost', { uid, pid, zid, tid, vote, error: err });
    throw err;
  }
}

export { votesPost };
