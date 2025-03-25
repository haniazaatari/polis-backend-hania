import _ from 'underscore';
import { addNoMoreCommentsRecord, getAuthorUidsForComments } from '../../db/comments.js';
import {
  updateConversationModifiedTime,
  updateLastInteractionTimeForConversation,
  updateVoteCount
} from '../../db/conversationUpdates.js';
import { getConversationInfo } from '../../db/conversations.js';
import { addParticipant, getSocialParticipants } from '../../db/participants.js';
import { getParticipantId } from '../../db/participants.js';
import { addStar } from '../../db/stars.js';
import { getVotesForZidPidsWithTimestampCheck } from '../../db/votes-queries.js';
import { getFilteredVotesForParticipant, getVotesForParticipant, votesPost } from '../../db/votes.js';
import logger from '../../utils/logger.js';
import { pullXInfoIntoSubObjects } from '../../utils/participants.js';
import { getPca } from '../../utils/pca.js';
import polisTypes from '../../utils/polisTypes.js';
import { getNextComment } from '../comment/commentService.js';
import { getBidsForPids } from '../math/mathService.js';
import { addParticipantAndMetadata } from '../participant/participantService.js';

/**
 * Get votes for the current user
 * @param {number} zid - Conversation ID
 * @param {number} uid - User ID
 * @returns {Promise<Array>} - Array of votes
 */
async function getVotesForMe(zid, uid) {
  try {
    // Get the participant ID for the user
    const pid = await getParticipantId(zid, uid);

    if (pid < 0) {
      throw new Error('polis_err_getting_pid');
    }

    return await getVotesForParticipant(zid, pid);
  } catch (err) {
    logger.error('Error getting votes for user', { error: err, zid, uid });
    throw new Error('polis_err_getting_votes');
  }
}

/**
 * Get author UIDs of featured comments
 * @param {number} zid - Conversation ID
 * @returns {Promise<Array>} - Array of author UIDs
 */
async function getAuthorUidsOfFeaturedComments(zid) {
  try {
    const pcaResult = await getPca(zid, 0);

    if (!pcaResult || typeof pcaResult !== 'object' || pcaResult === null || !('asPOJO' in pcaResult)) {
      logger.debug(`No PCA data available for zid ${zid}, returning empty array of featured comments`);
      return [];
    }

    const pcaData = pcaResult.asPOJO;
    pcaData.consensus = pcaData.consensus || {};
    pcaData.consensus.agree = pcaData.consensus.agree || [];
    pcaData.consensus.disagree = pcaData.consensus.disagree || [];

    const consensusTids = _.union(_.pluck(pcaData.consensus.agree, 'tid'), _.pluck(pcaData.consensus.disagree, 'tid'));

    let groupTids = [];
    if (pcaData.repness) {
      for (const gid in pcaData.repness) {
        const commentData = pcaData.repness[gid] || [];
        groupTids = _.union(groupTids, _.pluck(commentData, 'tid'));
      }
    }

    let featuredTids = _.union(consensusTids, groupTids);

    // Filter out any undefined, null, or non-numeric values
    featuredTids = featuredTids.filter((tid) => tid !== undefined && tid !== null && !Number.isNaN(Number(tid)));

    featuredTids.sort();
    featuredTids = _.uniq(featuredTids);

    if (featuredTids.length === 0) {
      logger.debug(`No featured tids found for zid ${zid}, returning empty array`);
      return [];
    }

    return await getAuthorUidsForComments(zid, featuredTids);
  } catch (err) {
    logger.error('Error getting author UIDs of featured comments', err);
    return [];
  }
}

/**
 * Execute the famous votes query
 * @param {Object} p - Parameters
 * @returns {Promise<Object>} - Famous votes data
 */
async function doFamousQuery(p) {
  try {
    const uid = p?.uid;
    const zid = p?.zid;
    const math_tick = p?.math_tick;
    const hardLimit = _.isUndefined(p?.ptptoiLimit) ? 30 : p?.ptptoiLimit;
    const mod = 0;

    // Get conversation info and author UIDs of featured comments
    const [conv, authorUids] = await Promise.all([getConversationInfo(zid), getAuthorUidsOfFeaturedComments(zid)]);

    // If the conversation is anonymous, return empty object
    if (conv.is_anon) {
      return {};
    }

    // Get social participants
    let participantsWithSocialInfo = await getSocialParticipants(zid, uid, hardLimit, mod, math_tick, authorUids);
    participantsWithSocialInfo = participantsWithSocialInfo || [];

    // Process participant data
    participantsWithSocialInfo = participantsWithSocialInfo.map((p) => {
      const x = pullXInfoIntoSubObjects(p);
      if (p.priority === 1000) {
        x.isSelf = true;
      }
      return x;
    });

    // Get PIDs and create PID to data mapping
    let pids = participantsWithSocialInfo.map((p) => p.pid);
    const pidToData = _.indexBy(participantsWithSocialInfo, 'pid');

    // Sort and deduplicate PIDs
    pids.sort((a, b) => a - b);
    pids = _.uniq(pids, true);

    // Get votes and bids for PIDs
    const vectors = await getVotesForZidPidsWithTimestampCheck(zid, pids, math_tick);
    const pidsToBids = await getBidsForPids(zid, -1, pids);

    // Process the data
    _.each(vectors, (value, pidStr) => {
      const pidNum = Number.parseInt(pidStr, 10);
      const bid = pidsToBids[pidNum];
      const notInBucket = _.isUndefined(bid);
      const isSelf = pidToData[pidNum]?.isSelf;

      if (notInBucket && !isSelf) {
        delete pidToData[pidNum];
      } else if (pidToData[pidNum]) {
        pidToData[pidNum].votes = value;
        pidToData[pidNum].bid = bid;
      }
    });

    return pidToData;
  } catch (err) {
    logger.error('Error in doFamousQuery', err);
    // Return empty object on error instead of throwing
    return {};
  }
}

/**
 * Submit a vote to the database
 * @param {number} uid - User ID
 * @param {number} pid - Participant ID
 * @param {number} zid - Conversation ID
 * @param {number} tid - Comment ID
 * @param {string} xid - External ID
 * @param {number} voteType - Vote type (-1, 0, 1)
 * @param {number} weight - Vote weight
 * @param {boolean} high_priority - Whether the vote is high priority
 * @returns {Promise<Object>} - Vote result
 */
async function submitVote(uid, pid, zid, tid, xid, voteType, weight, high_priority) {
  try {
    return await votesPost(uid, pid, zid, tid, xid, voteType, weight, high_priority);
  } catch (err) {
    logger.error('Error submitting vote', { uid, pid, zid, tid, voteType, error: err });
    throw err;
  }
}

/**
 * Get votes for a single participant
 * @param {Object} p - Parameters
 * @returns {Promise<Array>} - Array of votes
 */
function getVotesForSingleParticipant(p) {
  return getFilteredVotesForParticipant(p);
}

/**
 * Process a vote and return the next comment
 * @param {Object} voteParams - Vote parameters
 * @param {Object} req - Express request object (for addParticipantAndMetadata)
 * @param {string} permanent_cookie - Permanent cookie for participant
 * @returns {Promise<Object>} - Created vote and next comment
 */
async function processVote(voteParams, req, permanent_cookie) {
  const { uid, pid: initialPid, zid, tid, xid, vote, weight, high_priority, starred, lang } = voteParams;

  // First pid check - use addParticipantAndMetadata if pid is undefined
  let pid = initialPid;
  if (_.isUndefined(pid)) {
    try {
      const result = await addParticipantAndMetadata(zid, uid, req, permanent_cookie);
      // Handle both array and single object returns
      if (Array.isArray(result)) {
        pid = result[0]?.pid;
      } else if (result && typeof result === 'object') {
        pid = result.pid;
      }
    } catch (err) {
      logger.error('Error adding participant and metadata', err);
      // Continue to the next check
    }
  }

  // Second pid check - use addParticipant if pid is still undefined or invalid
  if (_.isUndefined(pid) || pid < 0) {
    try {
      const rows = await addParticipant(zid, uid);
      if (Array.isArray(rows) && rows.length > 0) {
        pid = rows[0].pid;
      } else if (rows && typeof rows === 'object') {
        pid = rows.pid;
      }
    } catch (err) {
      logger.error('Error adding participant as fallback', err);
      throw new Error('polis_err_adding_participant');
    }
  }

  // Final check to ensure we have a valid pid
  if (_.isUndefined(pid) || pid < 0) {
    logger.error('Failed to obtain a valid participant ID', { uid, zid });
    throw new Error('polis_err_invalid_pid');
  }

  // Submit the vote
  const voteResult = await submitVote(uid, pid, zid, tid, xid, vote, weight, high_priority);
  const createdVote = voteResult.vote;
  const createdTime = createdVote.created;

  // Update conversation metadata
  setTimeout(() => {
    updateConversationModifiedTime(zid, createdTime);
    updateLastInteractionTimeForConversation(zid, uid);
    updateVoteCount(zid, pid);
  }, 100);

  // Add star if specified
  if (!_.isUndefined(starred)) {
    await addStar(zid, tid, pid, starred, createdTime);
  }

  // Get the next comment
  const nextComment = await getNextComment(zid, pid, [], true, lang);

  // Prepare the result
  const result = {};
  if (nextComment) {
    result.nextComment = nextComment;
  } else {
    await addNoMoreCommentsRecord(zid, pid);
  }

  result.currentPid = pid;

  // Add moderation options if needed
  if (result.shouldMod) {
    result.modOptions = {};
    if (vote === polisTypes.reactions.pull) {
      result.modOptions.as_important = true;
      result.modOptions.as_factual = true;
      result.modOptions.as_feeling = true;
    } else if (vote === polisTypes.reactions.push) {
      result.modOptions.as_notmyfeeling = true;
      result.modOptions.as_notgoodidea = true;
      result.modOptions.as_notfact = true;
      result.modOptions.as_abusive = true;
    } else if (vote === polisTypes.reactions.pass) {
      result.modOptions.as_unsure = true;
      result.modOptions.as_spam = true;
      result.modOptions.as_abusive = true;
    }
  }

  return result;
}

export { doFamousQuery, getVotesForSingleParticipant, submitVote, getVotesForMe, processVote };
