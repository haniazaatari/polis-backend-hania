import _ from 'underscore';
import * as db from '../db/index.js';
import logger from '../utils/logger.js';

/**
 * Get demographics for voters on comments
 * @param {number} zid - Conversation ID
 * @param {Array<Object>} comments - Comments to get demographics for
 * @returns {Promise<Array<Object>>} - Comments with demographics
 */
async function getDemographicsForVotersOnComments(zid, comments) {
  try {
    const [votes, demo] = await db.getVotesAndDemographics(zid);

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

export { getDemographicsForVotersOnComments };
