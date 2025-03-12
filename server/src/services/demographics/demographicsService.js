import _ from 'underscore';
import * as demographicsRepository from '../../repositories/demographics/demographicsRepository.js';
import logger from '../../utils/logger.js';
import { getPidsForGid } from '../../utils/participants.js';
import polisTypes from '../../utils/polisTypes.js';

/**
 * Get group demographics for a conversation
 * @param {number} zid - Conversation ID
 * @param {boolean} isModerator - Whether the requester is a moderator
 * @param {number|undefined} rid - Report ID (optional)
 * @returns {Promise<Array>} - Array of group demographics
 */
async function getGroupDemographics(zid, isModerator, rid) {
  try {
    // Check authorization
    const isReportQuery = !_.isUndefined(rid);
    if (!isModerator && !isReportQuery) {
      throw new Error('polis_err_groupDemographics_auth');
    }

    // Get group PIDs and demographics data
    const [group0Pids, group1Pids, group2Pids, group3Pids, group4Pids, participantDemographics, metaVotes] =
      await Promise.all([
        getPidsForGid(zid, 0, -1),
        getPidsForGid(zid, 1, -1),
        getPidsForGid(zid, 2, -1),
        getPidsForGid(zid, 3, -1),
        getPidsForGid(zid, 4, -1),
        demographicsRepository.getParticipantDemographicsForConversation(zid),
        demographicsRepository.getParticipantVotesForCommentsFlaggedWith_is_meta(zid)
      ]);

    // Prepare group data
    const groupPids = [];
    const groupStats = [];

    // Add groups that have participants
    for (let i = 0; i < 5; i++) {
      const currentGroup = [group0Pids, group1Pids, group2Pids, group3Pids, group4Pids][i];
      if (currentGroup?.length) {
        groupPids.push(currentGroup);
        groupStats.push({
          gid: i,
          count: 0,
          gender_male: 0,
          gender_female: 0,
          gender_null: 0,
          birth_year: 0,
          birth_year_count: 0,
          meta_comment_agrees: {},
          meta_comment_disagrees: {},
          meta_comment_passes: {}
        });
      } else {
        break;
      }
    }

    // Index demographics by participant ID
    const meta = _.indexBy(participantDemographics, 'pid');
    const pidToMetaVotes = _.groupBy(metaVotes, 'pid');

    // Process each group
    for (let i = 0; i < groupStats.length; i++) {
      const s = groupStats[i];
      const pids = groupPids[i];

      // Process each participant in the group
      for (let p = 0; p < pids.length; p++) {
        const pid = pids[p];
        const ptptMeta = meta[pid];

        // Process demographic data if available
        if (ptptMeta) {
          s.count += 1;

          // Process gender
          let gender = null;
          if (_.isNumber(ptptMeta.gender_guess)) {
            gender = ptptMeta.gender_guess;
          }

          if (gender === 0) {
            s.gender_male += 1;
          } else if (gender === 1) {
            s.gender_female += 1;
          } else {
            s.gender_null += 1;
          }

          // Process birth year
          let birthYear = null;
          if (ptptMeta.birth_year_guess > 1900) {
            birthYear = ptptMeta.birth_year_guess;
          }

          if (birthYear > 1900) {
            s.birth_year += birthYear;
            s.birth_year_count += 1;
          }
        }

        // Process meta votes if available
        const ptptMetaVotes = pidToMetaVotes[pid];
        if (ptptMetaVotes) {
          for (let v = 0; v < ptptMetaVotes.length; v++) {
            const vote = ptptMetaVotes[v];

            if (vote.vote === polisTypes.reactions.pass) {
              s.meta_comment_passes[vote.tid] = 1 + (s.meta_comment_passes[vote.tid] || 0);
            } else if (vote.vote === polisTypes.reactions.pull) {
              s.meta_comment_agrees[vote.tid] = 1 + (s.meta_comment_agrees[vote.tid] || 0);
            } else if (vote.vote === polisTypes.reactions.push) {
              s.meta_comment_disagrees[vote.tid] = 1 + (s.meta_comment_disagrees[vote.tid] || 0);
            }
          }
        }
      }

      // Calculate averages
      if (s.birth_year_count > 0) {
        s.birth_year = s.birth_year / s.birth_year_count;
      }
      if (s.birth_year_guess_count > 0) {
        s.birth_year_guess = s.birth_year_guess / s.birth_year_guess_count;
      }
    }

    return groupStats;
  } catch (error) {
    logger.error('Error getting group demographics', error);
    throw error;
  }
}

export { getGroupDemographics };
