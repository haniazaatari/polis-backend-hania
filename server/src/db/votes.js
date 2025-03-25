import { isXidWhitelisted } from '../repositories/xid/xidRepository.js';
import { isDuplicateKey } from '../utils/common.js';
import logger from '../utils/logger.js';
import { queryP, query_readOnly } from './pg-query.js';
import { sql_votes_latest_unique } from './sql.js';

/**
 * Insert a vote into the database
 * @param {number} _uid - User ID
 * @param {number} pid - Participant ID
 * @param {object} conv - Conversation object
 * @param {number} tid - Comment ID
 * @param {number} vote - Vote value (-1, 0, 1)
 * @param {number} weight - Vote weight
 * @param {boolean} high_priority - Whether the vote is high priority (not used in the schema)
 * @returns {Promise<Object>} - The vote result
 */
async function doVotesPost(_uid, pid, conv, tid, vote, weight, high_priority) {
  // Define these variables outside the try/catch so they can be accessed in the catch block
  let query = '';
  let params = [];

  try {
    if (!conv || !conv.zid) {
      throw new Error('polis_err_missing_conversation');
    }

    // Validate pid - it can be 0 (which is falsy in JavaScript) but not undefined/null
    if (pid === undefined || pid === null || pid < 0) {
      throw new Error('polis_err_missing_pid');
    }

    const zid = conv.zid;
    const effectiveWeight = weight || 0;
    const weight_x_32767 = Math.trunc(effectiveWeight * 32767);

    // Log the parameters for debugging
    logger.debug('doVotesPost parameters', {
      pid,
      zid,
      tid,
      vote,
      weight_x_32767,
      high_priority,
      pidType: typeof pid,
      zidType: typeof zid,
      tidType: typeof tid,
      voteType: typeof vote,
      pidValue: pid !== null && pid !== undefined ? String(pid) : 'null/undefined',
      zidValue: zid !== null && zid !== undefined ? String(zid) : 'null/undefined',
      tidValue: tid !== null && tid !== undefined ? String(tid) : 'null/undefined',
      voteValue: vote !== null && vote !== undefined ? String(vote) : 'null/undefined'
    });

    // Note: The votes table schema has zid, pid, tid, vote, weight_x_32767, created, and high_priority columns
    query =
      'INSERT INTO votes (pid, zid, tid, vote, weight_x_32767, created, high_priority) VALUES ($1, $2, $3, $4, $5, default, $6) RETURNING *;';

    // Important: Pass the parameters as an array to queryP
    params = [pid, zid, tid, vote, weight_x_32767, !!high_priority];

    // Log the query and parameters
    logger.debug('doVotesPost query', {
      query,
      params,
      paramsJSON: JSON.stringify(params),
      paramsDetail: params.map((p, i) => `$${i + 1}=${p} (${typeof p})`)
    });

    // Execute the query and get the result - pass params as a single array argument
    const rows = await queryP(query, params);

    if (!rows || !rows.length) {
      throw new Error('polis_err_voting_failed_no_result');
    }

    const voteResult = rows[0];
    return {
      conv: conv,
      vote: voteResult
    };
  } catch (err) {
    if (isDuplicateKey(err)) {
      throw new Error('polis_err_vote_duplicate');
    }

    // Log the full error details
    logger.error('polis_err_vote_other', {
      error: err,
      message: err.message,
      stack: err.stack,
      code: err.code,
      position: err.position,
      detail: err.detail,
      hint: err.hint,
      internalPosition: err.internalPosition,
      internalQuery: err.internalQuery,
      where: err.where,
      schema: err.schema,
      table: err.table,
      column: err.column,
      dataType: err.dataType,
      constraint: err.constraint,
      query: query,
      params: JSON.stringify(params)
    });

    throw new Error('polis_err_vote_other');
  }
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
      throw new Error('polis_err_param_pid_invalid');
    }

    if (tid === undefined || tid === null || tid < 0) {
      throw new Error('polis_err_param_tid_invalid');
    }

    if (zid === undefined || zid === null) {
      throw new Error('polis_err_missing_zid');
    }

    // Check if the conversation exists and is active
    const rows = await query_readOnly('SELECT * FROM conversations WHERE zid = ($1);', [zid]);

    if (!rows || !rows.length) {
      throw new Error('polis_err_unknown_conversation');
    }

    const conv = rows[0];

    if (!conv.is_active) {
      throw new Error('polis_err_conversation_is_closed');
    }

    // Check if the XID is whitelisted if required
    if (conv.use_xid_whitelist && xid) {
      const is_whitelisted = await isXidWhitelisted(conv.owner, xid);

      if (!is_whitelisted) {
        throw new Error('polis_err_xid_not_whitelisted');
      }
    }

    // Insert the vote
    return await doVotesPost(uid, pid, conv, tid, vote, weight, high_priority);
  } catch (err) {
    logger.error('Error in votesPost', { uid, pid, zid, tid, vote, error: err });
    // Ensure we're always throwing Error objects, not strings
    if (typeof err === 'string') {
      throw new Error(err);
    }
    throw err;
  }
}

/**
 * Get votes for a participant
 * @param {number} zid - Conversation ID
 * @param {number} pid - Participant ID
 * @returns {Promise<Array>} - Array of votes
 */
async function getVotesForParticipant(zid, pid) {
  try {
    const result = await query_readOnly('SELECT * FROM votes WHERE zid = ($1) AND pid = ($2);', [zid, pid]);
    return result.map((vote) => {
      vote.weight = vote.weight_x_32767 / 32767;
      return vote;
    });
  } catch (err) {
    logger.error('Error getting votes for participant', { error: err, zid, pid });
    throw new Error('polis_err_getting_votes');
  }
}

/**
 * Get votes for a single participant with filters
 * @param {Object} params - Query parameters
 * @returns {Promise<Array>} - Array of votes
 */
async function getFilteredVotesForParticipant(params) {
  // Early return if pid is undefined, matching legacy behavior
  if (params.pid === undefined) {
    return [];
  }

  // Use the sql_votes_latest_unique view to match original behavior
  let q = sql_votes_latest_unique
    .select(sql_votes_latest_unique.star())
    .where(sql_votes_latest_unique.zid.equals(params.zid));

  // Use explicit undefined check instead of truthy check to handle pid=0 correctly
  if (params.pid !== undefined) {
    q = q.where(sql_votes_latest_unique.pid.equals(params.pid));
  }

  if (params.tid !== undefined) {
    q = q.where(sql_votes_latest_unique.tid.equals(params.tid));
  }

  const results = await query_readOnly(q.toString());
  return Array.isArray(results) ? results : [];
}

export { getVotesForParticipant, getFilteredVotesForParticipant, votesPost };
