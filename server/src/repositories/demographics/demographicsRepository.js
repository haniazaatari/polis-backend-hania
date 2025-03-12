import _ from 'underscore';
import { pgQueryP_readOnly } from '../../db/pg-query.js';
import logger from '../../utils/logger.js';

/**
 * Get participant demographics for a conversation
 * @param {number} zid - Conversation ID
 * @returns {Promise<Array>} - Array of participant demographics
 */
async function getParticipantDemographicsForConversation(zid) {
  try {
    return await pgQueryP_readOnly(
      'SELECT * FROM demographic_data LEFT JOIN participants ON participants.uid = demographic_data.uid WHERE zid = ($1);',
      [zid]
    );
  } catch (error) {
    logger.error('Error in getParticipantDemographicsForConversation', error);
    throw error;
  }
}

/**
 * Get participant votes for comments flagged with is_meta
 * @param {number} zid - Conversation ID
 * @returns {Promise<Array>} - Array of votes
 */
async function getParticipantVotesForCommentsFlaggedWith_is_meta(zid) {
  try {
    return await pgQueryP_readOnly(
      'SELECT pid, tid, vote FROM votes_latest_unique v ' +
        'JOIN comments c ON v.tid = c.tid ' +
        'WHERE v.zid = ($1) AND c.is_meta = TRUE;',
      [zid]
    );
  } catch (error) {
    logger.error('Error in getParticipantVotesForCommentsFlaggedWith_is_meta', error);
    throw error;
  }
}

/**
 * Get demographics for voters on comments
 * @param {number} zid - Conversation ID
 * @param {Array<Object>} comments - Comments to get demographics for
 * @returns {Promise<Array<Object>>} - Comments with demographics
 */
async function getDemographicsForVotersOnComments(zid, comments) {
  try {
    const [votes, demo] = await Promise.all([
      pgQueryP_readOnly('SELECT pid, tid, vote FROM votes_latest_unique WHERE zid = ($1);', [zid]),
      pgQueryP_readOnly(
        'SELECT p.pid, d.* FROM participants p LEFT JOIN demographic_data d ON p.uid = d.uid WHERE p.zid = ($1);',
        [zid]
      )
    ]);

    const processedDemo = demo.map((d) => {
      return {
        pid: d.pid,
        gender: d.gender,
        ageRange: d.age_range
      };
    });

    const demoByPid = _.indexBy(processedDemo, 'pid');
    const votesWithDemo = votes.map((v) => {
      return _.extend(v, demoByPid[v.pid]);
    });

    const votesByTid = _.groupBy(votesWithDemo, 'tid');
    const tidToVotes = {};

    _.each(votesByTid, (votes, tid) => {
      const agrees = _.filter(votes, (v) => v.vote === 1);
      const disagrees = _.filter(votes, (v) => v.vote === -1);
      const passes = _.filter(votes, (v) => v.vote === 0);

      const maleAgrees = _.filter(agrees, isGenderMale).length;
      const maleDisagrees = _.filter(disagrees, isGenderMale).length;
      const malePasses = _.filter(passes, isGenderMale).length;

      const femaleAgrees = _.filter(agrees, isGenderFemale).length;
      const femaleDisagrees = _.filter(disagrees, isGenderFemale).length;
      const femalePasses = _.filter(passes, isGenderFemale).length;

      tidToVotes[tid] = {
        tid: tid,
        agree_male: maleAgrees,
        agree_female: femaleAgrees,
        disagree_male: maleDisagrees,
        disagree_female: femaleDisagrees,
        pass_male: malePasses,
        pass_female: femalePasses
      };
    });

    // Attach demographics to comments
    return comments.map((c) => {
      const tid = c.tid;
      const demo = tidToVotes[tid] || {
        agree_male: 0,
        agree_female: 0,
        disagree_male: 0,
        disagree_female: 0,
        pass_male: 0,
        pass_female: 0
      };
      return _.extend({}, c, demo);
    });
  } catch (error) {
    logger.error('Error in getDemographicsForVotersOnComments', error);
    throw error;
  }
}

/**
 * Helper function to check if a demographic has male gender
 * @param {Object} demo - Demographic object
 * @returns {boolean} - True if the demographic has male gender
 */
function isGenderMale(demo) {
  return demo.gender === 0;
}

/**
 * Helper function to check if a demographic has female gender
 * @param {Object} demo - Demographic object
 * @returns {boolean} - True if the demographic has female gender
 */
function isGenderFemale(demo) {
  return demo.gender === 1;
}

export {
  getParticipantDemographicsForConversation,
  getParticipantVotesForCommentsFlaggedWith_is_meta,
  getDemographicsForVotersOnComments
};
