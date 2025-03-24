import {
  getCommenterCount,
  getCommentsForExport,
  getCommentsForGroupExport,
  getConversationMetadata,
  streamParticipantVotesForExport,
  streamVotesForExport
} from '../../db/exports.js';
import logger from '../../utils/logger.js';
import { getPca } from '../../utils/pca.js';
import { getZinvite } from '../zinvite/zinviteService.js';

const sep = '\n';

/**
 * Format text for CSV by escaping double quotes
 * @param {string} s - Text to format
 * @returns {string} - Formatted text
 */
export const formatEscapedText = (s) => `"${s.replace(/"/g, '""')}"`;

/**
 * Format CSV headers
 * @param {Object} colFns - Column functions
 * @returns {string} - CSV headers
 */
export function formatCSVHeaders(colFns) {
  return Object.keys(colFns).join(',');
}

/**
 * Format CSV row
 * @param {Object} row - Row data
 * @param {Object} colFns - Column functions
 * @returns {string} - CSV row
 */
export function formatCSVRow(row, colFns) {
  const fns = Object.values(colFns);
  let csv = '';
  for (let ii = 0; ii < fns.length; ii += 1) {
    if (ii > 0) csv += ',';
    csv += fns[ii](row);
  }
  return csv;
}

/**
 * Format CSV
 * @param {Object} colFns - Column functions
 * @param {Array} rows - Row data
 * @returns {string} - CSV
 */
export function formatCSV(colFns, rows) {
  let csv = formatCSVHeaders(colFns) + sep;
  if (rows.length > 0) {
    for (const row of rows) {
      csv += formatCSVRow(row, colFns);
      csv += sep;
    }
  }
  return csv;
}

/**
 * Load conversation summary
 * @param {number} zid - Conversation ID
 * @param {string} siteUrl - Site URL
 * @returns {Promise<Array>} - Conversation summary
 */
export async function loadConversationSummary(zid, siteUrl) {
  const [zinvite, convoRows, commentersRow, pca] = await Promise.all([
    getZinvite(zid),
    getConversationMetadata(zid),
    getCommenterCount(zid),
    getPca(zid)
  ]);

  if (!zinvite || !convoRows || !commentersRow || !pca) {
    throw new Error('polis_error_data_unknown_report');
  }

  const convo = convoRows[0];
  const commenters = commentersRow.count;
  const data = pca.asPOJO;

  return [
    ['topic', formatEscapedText(convo.topic)],
    ['url', `${siteUrl}/${zinvite}`],
    ['voters', Object.keys(data['user-vote-counts']).length],
    ['voters-in-conv', data['in-conv'].length],
    ['commenters', commenters],
    ['comments', data['n-cmts']],
    ['groups', Object.keys(data['group-clusters']).length],
    ['conversation-description', formatEscapedText(convo.description)]
  ].map((row) => row.join(','));
}

/**
 * Format datetime
 * @param {string} timestamp - Timestamp
 * @returns {string} - Formatted datetime
 */
export const formatDatetime = (timestamp) => new Date(Number.parseInt(timestamp)).toString();

/**
 * Get conversation summary
 * @param {number} zid - Conversation ID
 * @param {string} siteUrl - Site URL
 * @returns {Promise<string>} - Conversation summary CSV
 */
export async function getConversationSummary(zid, siteUrl) {
  const rows = await loadConversationSummary(zid, siteUrl);
  return rows.join(sep);
}

/**
 * Get comment summary
 * @param {number} zid - Conversation ID
 * @returns {Promise<string>} - Comment summary CSV
 */
export async function getCommentSummary(zid) {
  return new Promise((resolve, reject) => {
    const comments = new Map();

    getCommentsForExport(zid).then((commentRows) => {
      for (const comment of commentRows) {
        comment.agrees = 0;
        comment.disagrees = 0;
        comment.pass = 0;
        comments.set(comment.tid, comment);
      }

      streamVotesForExport(
        zid,
        (row) => {
          const comment = comments.get(row.tid);
          if (comment) {
            if (row.vote === -1) comment.agrees += 1;
            else if (row.vote === 1) comment.disagrees += 1;
            else if (row.vote === 0) comment.pass += 1;
          } else {
            logger.warn(`Comment row not found for [zid=${zid}, tid=${row.tid}]`);
          }
        },
        () => {
          commentRows.sort((a, b) => {
            return b.velocity - a.velocity;
          });

          const csv = formatCSV(
            {
              timestamp: (row) => String(Math.floor(Number.parseInt(row.created) / 1000)),
              datetime: (row) => formatDatetime(row.created),
              'comment-id': (row) => String(row.tid),
              'author-id': (row) => String(row.pid),
              agrees: (row) => String(row.agrees),
              disagrees: (row) => String(row.disagrees),
              moderated: (row) => String(row.mod),
              'comment-body': (row) => formatEscapedText(row.txt)
            },
            commentRows
          );

          resolve(csv);
        },
        (error) => {
          logger.error('polis_err_report_comments', error);
          reject(error);
        }
      );
    });
  });
}

/**
 * Get votes summary
 * @param {number} zid - Conversation ID
 * @returns {Promise<string>} - Votes summary CSV
 */
export async function getVotesSummary(zid) {
  return new Promise((resolve, reject) => {
    // Define formatters with the same column order and transformations as before
    const formatters = {
      timestamp: (row) => String(Math.floor(Number.parseInt(row.timestamp) / 1000)),
      datetime: (row) => formatDatetime(row.timestamp),
      'comment-id': (row) => String(row.tid),
      'voter-id': (row) => String(row.pid),
      vote: (row) => String(-row.vote)
    };

    // Create a buffer to collect the CSV data
    const csvRows = [];

    // Add the headers
    csvRows.push(formatCSVHeaders(formatters));

    // Use streaming to process the data
    streamVotesForExport(
      zid,
      // For each row, format it and add to our buffer
      (row) => {
        csvRows.push(formatCSVRow(row, formatters));
      },
      // When done, join all rows and resolve the promise
      () => {
        resolve(csvRows.join('\n'));
      },
      // On error, reject the promise
      (error) => {
        logger.error('polis_err_report_votes_csv', error);
        reject(error);
      }
    );
  });
}

/**
 * Get participant votes summary
 * @param {number} zid - Conversation ID
 * @returns {Promise<string>} - Participant votes summary CSV
 */
export async function getParticipantVotesSummary(zid) {
  // Get PCA data
  const pca = await getPca(zid);
  if (!pca?.asPOJO) {
    throw new Error('polis_error_no_pca_data');
  }

  // Get all comments for this conversation to match legacy behavior
  const commentRows = await getCommentsForExport(zid);
  const commentIds = commentRows.map((row) => row.tid);

  // Calculate comment counts per participant (matching legacy behavior)
  const participantCommentCounts = new Map();
  for (const row of commentRows) {
    const count = participantCommentCounts.get(row.pid) || 0;
    participantCommentCounts.set(row.pid, count + 1);
  }

  // Implement the legacy getGroupId function
  function getGroupId(pca, pid) {
    if (!pca || !pca.asPOJO) {
      return undefined;
    }
    const pcaData = pca.asPOJO;
    const inConv = pcaData['in-conv'];
    if (!inConv || !Array.isArray(inConv) || !inConv.includes(pid)) {
      logger.debug(`Participant ${pid} not found in in-conv array`);
      return undefined;
    }
    const baseClusters = pcaData['base-clusters'];
    const groupClusters = pcaData['group-clusters'];
    if (!baseClusters || !baseClusters.members || !Array.isArray(baseClusters.members)) {
      logger.debug('No base clusters found in PCA data');
      return undefined;
    }
    if (!groupClusters || !Array.isArray(groupClusters) || groupClusters.length === 0) {
      logger.debug('No group clusters found in PCA data');
      return undefined;
    }
    let baseClusterId = -1;
    for (let i = 0; i < baseClusters.members.length; i++) {
      const members = baseClusters.members[i];
      if (Array.isArray(members) && members.includes(pid)) {
        baseClusterId = i;
        break;
      }
    }
    if (baseClusterId === -1) {
      logger.debug(`Could not find base cluster for participant ${pid}`);
      return undefined;
    }
    for (const groupCluster of groupClusters) {
      if (groupCluster.members && Array.isArray(groupCluster.members) && groupCluster.members.includes(baseClusterId)) {
        return groupCluster.id;
      }
    }
    logger.debug(`Could not find group cluster for participant ${pid}`);
    return undefined;
  }

  return new Promise((resolve, reject) => {
    // Process votes by participant
    const participantVotes = new Map();

    streamParticipantVotesForExport(
      zid,
      (row) => {
        if (!participantVotes.has(row.pid)) {
          participantVotes.set(row.pid, {
            pid: row.pid,
            votes: new Map(),
            groupId: getGroupId(pca, row.pid),
            commentCount: participantCommentCounts.get(row.pid) || 0
          });
        }

        const participant = participantVotes.get(row.pid);
        // Use -row.vote to match legacy behavior (inverting the sign)
        participant.votes.set(row.tid, -row.vote);
      },
      () => {
        // Build CSV rows
        const csvRows = [];
        for (const participant of participantVotes.values()) {
          // Calculate vote statistics (matching legacy behavior)
          let agrees = 0;
          let disagrees = 0;
          for (const vote of participant.votes.values()) {
            if (vote === 1) agrees += 1;
            else if (vote === -1) disagrees += 1;
          }

          const csvRow = {
            participant: participant.pid,
            'group-id': participant.groupId,
            'n-comments': participant.commentCount,
            'n-votes': participant.votes.size,
            'n-agree': agrees,
            'n-disagree': disagrees
          };

          // Add a column for each comment ID
          for (const commentId of commentIds) {
            csvRow[`comment-${commentId}`] = participant.votes.get(commentId);
          }

          csvRows.push(csvRow);
        }

        // Define column formatters
        const colFns = {
          participant: (row) => String(row.participant),
          'group-id': (row) => (row['group-id'] === undefined ? '' : String(row['group-id'])),
          'n-comments': (row) => String(row['n-comments']),
          'n-votes': (row) => String(row['n-votes']),
          'n-agree': (row) => String(row['n-agree']),
          'n-disagree': (row) => String(row['n-disagree'])
        };

        // Add formatters for each comment ID
        for (const commentId of commentIds) {
          colFns[`comment-${commentId}`] = (row) => String(row[`comment-${commentId}`] || '');
        }

        resolve(formatCSV(colFns, csvRows));
      },
      (error) => {
        logger.error('polis_err_report_participant_votes_csv', error);
        reject(error);
      }
    );
  });
}

/**
 * Get comment groups summary
 * @param {number} zid - Conversation ID
 * @param {Function} filterFN - Filter function
 * @returns {Promise<string>} - Comment groups summary CSV
 */
export async function getCommentGroupsSummary(zid, filterFN) {
  const pca = await getPca(zid);
  if (!pca?.asPOJO) {
    throw new Error('polis_error_no_pca_data');
  }

  const groupClusters = pca.asPOJO['group-clusters'];
  const groupIds = Array.isArray(groupClusters)
    ? groupClusters.map((g) => g.id)
    : Object.keys(groupClusters).map(Number);

  const numGroups = groupIds.length;
  const groupVotes = pca.asPOJO['group-votes'];
  const groupAwareConsensus = pca.asPOJO['group-aware-consensus'];
  const commentExtremity = pca.asPOJO.pca?.['comment-extremity'] || [];

  const commentRows = await getCommentsForGroupExport(zid);
  const commentTexts = new Map(commentRows.map((row) => [row.tid, row.txt]));

  const commentStats = new Map();
  const tidToExtremityIndex = new Map();
  const mathTids = pca.asPOJO.tids || [];

  commentExtremity.forEach((_extremity, index) => {
    const tid = mathTids[index];
    if (tid !== undefined) {
      tidToExtremityIndex.set(tid, index);
    }
  });

  for (const groupId of groupIds) {
    const groupVoteStats = groupVotes[groupId];
    if (!groupVoteStats?.votes) continue;

    for (const [tidStr, votes] of Object.entries(groupVoteStats.votes)) {
      const tid = Number.parseInt(tidStr);

      if (!commentStats.has(tid)) {
        const groupStats = {};
        for (const gid of groupIds) {
          groupStats[gid] = { votes: 0, agrees: 0, disagrees: 0, passes: 0 };
        }

        commentStats.set(tid, {
          tid: tid,
          txt: commentTexts.get(tid) || '',
          total_votes: 0,
          total_agrees: 0,
          total_disagrees: 0,
          total_passes: 0,
          group_stats: groupStats
        });
      }

      const stats = commentStats.get(tid);
      if (!stats) {
        logger.warn(`Comment stats not found for tid ${tid}`);
        continue;
      }

      const groupStat = stats.group_stats[groupId];
      if (!groupStat) {
        logger.warn(`Group stat not found for tid ${tid}, group ${groupId}`);
        continue;
      }

      const { A, D, P } = votes;
      groupStat.votes = (A || 0) + (D || 0) + (P || 0);
      groupStat.agrees = A || 0;
      groupStat.disagrees = D || 0;
      groupStat.passes = P || 0;

      stats.total_votes += groupStat.votes;
      stats.total_agrees += groupStat.agrees;
      stats.total_disagrees += groupStat.disagrees;
      stats.total_passes += groupStat.passes;
    }
  }

  const csvRows = [];

  for (const stats of commentStats.values()) {
    const extremityIndex = tidToExtremityIndex.get(stats.tid);
    const extremity = extremityIndex !== undefined ? commentExtremity[extremityIndex] : null;

    const row = {
      'comment-id': stats.tid,
      comment: stats.txt,
      agrees: stats.total_agrees,
      disagrees: stats.total_disagrees,
      passes: stats.total_passes,
      votes: stats.total_votes,
      'comment-extremity': extremity,
      'group-aware-consensus': groupAwareConsensus?.[stats.tid],
      num_groups: numGroups
    };

    for (const groupId of groupIds) {
      const groupStat = stats.group_stats[groupId];
      row[`group-${groupId}-agrees`] = groupStat.agrees;
      row[`group-${groupId}-disagrees`] = groupStat.disagrees;
      row[`group-${groupId}-passes`] = groupStat.passes;
      row[`group-${groupId}-votes`] = groupStat.votes;
    }

    if (!filterFN || filterFN(row)) {
      csvRows.push(row);
    }
  }

  const colFns = {
    'comment-id': (row) => String(row['comment-id']),
    comment: (row) => formatEscapedText(row.comment),
    agrees: (row) => String(row.agrees),
    disagrees: (row) => String(row.disagrees),
    passes: (row) => String(row.passes),
    votes: (row) => String(row.votes),
    'comment-extremity': (row) => String(row['comment-extremity'] || ''),
    'group-aware-consensus': (row) => String(row['group-aware-consensus'] || '')
  };

  for (const groupId of groupIds) {
    colFns[`group-${groupId}-agrees`] = (row) => String(row[`group-${groupId}-agrees`]);
    colFns[`group-${groupId}-disagrees`] = (row) => String(row[`group-${groupId}-disagrees`]);
    colFns[`group-${groupId}-passes`] = (row) => String(row[`group-${groupId}-passes`]);
    colFns[`group-${groupId}-votes`] = (row) => String(row[`group-${groupId}-votes`]);
  }

  return formatCSV(colFns, csvRows);
}
