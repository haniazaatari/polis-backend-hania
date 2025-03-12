import _ from 'underscore';
import { addNoMoreCommentsRecord } from '../../db/comments.js';
import {
  updateConversationModifiedTime,
  updateLastInteractionTimeForConversation,
  updateVoteCount
} from '../../db/conversationUpdates.js';
import { getConversationInfo } from '../../db/conversations.js';
import { addParticipant, getSocialParticipants } from '../../db/participants.js';
import { pgQueryP, query_readOnly } from '../../db/pg-query.js';
import { sql_votes_latest_unique } from '../../db/sql.js';
import { addStar } from '../../db/stars.js';
import { getVotesForZidPidsWithTimestampCheck } from '../../db/votes-queries.js';
import { votesPost } from '../../db/votes.js';
import { getParticipantId } from '../../repositories/participant/participantRepository.js';
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

    // Get the votes for the participant
    const result = await query_readOnly('SELECT * FROM votes WHERE zid = ($1) AND pid = ($2);', [zid, pid]);

    // Normalize the weight
    return result.rows.map((vote) => {
      vote.weight = vote.weight / 32767;
      return vote;
    });
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
      return [];
    }

    const pcaData = pcaResult.asPOJO;
    pcaData.consensus = pcaData.consensus || {};
    pcaData.consensus.agree = pcaData.consensus.agree || [];
    pcaData.consensus.disagree = pcaData.consensus.disagree || [];

    const consensusTids = _.union(_.pluck(pcaData.consensus.agree, 'tid'), _.pluck(pcaData.consensus.disagree, 'tid'));

    let groupTids = [];
    for (const gid in pcaData.repness) {
      const commentData = pcaData.repness[gid];
      groupTids = _.union(groupTids, _.pluck(commentData, 'tid'));
    }

    let featuredTids = _.union(consensusTids, groupTids);
    featuredTids.sort();
    featuredTids = _.uniq(featuredTids);

    if (featuredTids.length === 0) {
      return [];
    }

    const q = `with authors as (select distinct(uid) from comments where zid = ($1) and tid in (${featuredTids.join(',')}) order by uid) select authors.uid from authors union select authors.uid from authors inner join xids on xids.uid = authors.uid order by uid;`;
    const comments = await pgQueryP(q, [zid]);

    let uids = _.pluck(comments, 'uid');
    uids = _.uniq(uids);

    return uids;
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
    throw err;
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
function submitVote(uid, pid, zid, tid, xid, voteType, weight, high_priority) {
  try {
    return votesPost(uid, pid, zid, tid, xid, voteType, weight, high_priority);
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
  // Early return if pid is undefined, matching original behavior
  if (_.isUndefined(p.pid)) {
    return Promise.resolve([]);
  }

  // Use the sql_votes_latest_unique view to match original behavior
  let q = sql_votes_latest_unique
    .select(sql_votes_latest_unique.star())
    .where(sql_votes_latest_unique.zid.equals(p.zid));

  if (!_.isUndefined(p.pid)) {
    q = q.where(sql_votes_latest_unique.pid.equals(p.pid));
  }

  if (!_.isUndefined(p.tid)) {
    q = q.where(sql_votes_latest_unique.tid.equals(p.tid));
  }

  return query_readOnly(q.toString()).then((results) => results.rows);
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
      const rows = await addParticipantAndMetadata(zid, uid, req, permanent_cookie);
      pid = rows[0].pid;
    } catch (err) {
      logger.error('Error adding participant and metadata', err);
      // Continue to the next check
    }
  }

  // Second pid check - use addParticipant if pid is still undefined
  if (_.isUndefined(pid)) {
    const rows = await addParticipant(zid, uid);
    pid = rows[0].pid;
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
