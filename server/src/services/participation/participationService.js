/**
 * Participation Service
 * Handles business logic for participation-related operations
 */
import _ from 'underscore';
import { queryP_readOnly } from '../../db/pg-query.js';
import { getNextComment } from '../../services/comment/commentService.js';
import { getOneConversation } from '../../services/conversation/conversationService.js';
import { getXids } from '../../services/math/mathService.js';
import { getParticipant } from '../../services/participant/participantService.js';
import { getUser } from '../../services/user/userService.js';
import { doFamousQuery, getVotesForSingleParticipant } from '../../services/vote/voteService.js';
import logger from '../../utils/logger.js';
import { getPca } from '../../utils/pca.js';
import { isConversationOwner } from '../zinvite/zinviteService.js';

/**
 * Get participation data for a conversation
 * @param {number} zid - Conversation ID
 * @param {number} uid - User ID
 * @param {boolean} strict - Whether to enforce strict XID validation
 * @returns {Promise<Object>} - Participation data
 */
async function getParticipation(zid, uid, strict) {
  try {
    // Check if user is the owner of the conversation
    const isUserOwner = await isConversationOwner(zid, uid);
    if (!isUserOwner) {
      throw new Error('polis_err_get_participation_auth');
    }

    // Get vote counts, comment counts, and XIDs
    const [voteCountRows, commentCountRows, pidXidRows] = await Promise.all([
      queryP_readOnly('select pid, count(*) from votes where zid = ($1) group by pid;', [zid]),
      queryP_readOnly('select pid, count(*) from comments where zid = ($1) group by pid;', [zid]),
      getXids(zid)
    ]);

    // If strict mode is enabled and there are no XIDs, fail
    if (strict && !pidXidRows.length) {
      throw new Error('polis_err_get_participation_missing_xids This conversation has no xids for its participants.');
    }

    // Create a result object with vote and comment counts
    const result = {};

    // Helper function to get or create an entry for a pid
    function getOrCreateEntry(pid) {
      if (_.isUndefined(result[pid])) {
        result[pid] = { votes: 0, comments: 0 };
      }
      return result[pid];
    }

    // Add vote counts
    for (let i = 0; i < voteCountRows.length; i++) {
      const r = voteCountRows[i];
      getOrCreateEntry(r.pid).votes = Number(r.count);
    }

    // Add comment counts
    for (let i = 0; i < commentCountRows.length; i++) {
      const r = commentCountRows[i];
      getOrCreateEntry(r.pid).comments = Number(r.count);
    }

    // If there are XIDs, map the results to XID-based results
    if (pidXidRows?.length) {
      const pidToXid = {};
      for (let i = 0; i < pidXidRows.length; i++) {
        pidToXid[pidXidRows[i].pid] = pidXidRows[i].xid;
      }

      const xidBasedResult = {};
      let size = 0;
      _.each(result, (val, key) => {
        xidBasedResult[pidToXid[key]] = val;
        size += 1;
      });

      // If strict mode is enabled and there are missing XIDs, fail
      if (strict && (commentCountRows.length || voteCountRows.length) && size > 0) {
        throw new Error(
          'polis_err_get_participation_missing_xids This conversation is missing xids for some of its participants.'
        );
      }

      return xidBasedResult;
    }

    return result;
  } catch (err) {
    logger.error('Error getting participation data', { error: err, zid, uid });
    throw err;
  }
}

/**
 * Get participation initialization data
 * @param {Object} params - Parameters for initialization
 * @returns {Promise<Object>} - Initialization data
 */
async function getParticipationInit(params) {
  try {
    logger.info('getParticipationInit');
    const { zid, uid, pid, xid, owner_uid, conversation_id, lang } = params;
    logger.debug('getParticipationInit params:', params);

    // Helper functions to conditionally execute promises
    function ifConv(f, args) {
      if (conversation_id) {
        return f.apply(null, args);
      }
      return Promise.resolve(null);
    }

    function ifConvAndAuth(f, args) {
      if (uid) {
        return ifConv(f, args);
      }
      return Promise.resolve(null);
    }

    // Get all necessary data in parallel
    try {
      const [user, ptpt, nextComment, conversation, votes, pca, famous] = await Promise.all([
        getUser(uid, zid, xid, owner_uid),
        ifConvAndAuth(getParticipant, [zid, uid]),
        ifConv(getNextComment, [zid, pid, [], true, lang]),
        ifConv(getOneConversation, [zid, uid, lang]),
        ifConv(getVotesForSingleParticipant, [params]),
        ifConv(getPca, [zid, -1]),
        ifConv(doFamousQuery, [params])
      ]);

      // Construct the response object
      const result = {
        user,
        ptpt,
        nextComment: nextComment || {},
        conversation,
        votes: votes || [],
        pca: pca ? (pca.asJSON ? pca.asJSON : null) : null,
        famous,
        acceptLanguage: params.acceptLanguage
      };

      // If no conversation_id was provided, set conversation to null to match legacy behavior
      if (_.isUndefined(conversation_id)) {
        result.conversation = null;
      }
      // Clean up sensitive or unnecessary data
      else if (result.conversation) {
        result.conversation.zid = undefined;
        result.conversation.conversation_id = conversation_id;
      }

      if (result.ptpt) {
        result.ptpt.zid = undefined;
      }

      for (let i = 0; i < result.votes.length; i++) {
        result.votes[i].zid = undefined;
      }

      if (!_.isUndefined(pid)) {
        result.nextComment.currentPid = pid;
      }

      return result;
    } catch (err) {
      logger.error('Error in Promise.all for getParticipationInit', {
        error: err,
        message: err.message,
        stack: err.stack,
        params: JSON.stringify(params)
      });
      throw err;
    }
  } catch (err) {
    logger.error('Error getting participation init data', {
      error: err,
      message: err.message,
      stack: err.stack,
      params: JSON.stringify(params)
    });
    throw err;
  }
}

export { getParticipation, getParticipationInit };
