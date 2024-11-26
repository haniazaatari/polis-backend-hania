import {
  queryP_readOnly as pgQueryP_readOnly,
  stream_queryP_readOnly as stream_pgQueryP_readOnly
} from '../db/pg-query.js';
import fail from '../utils/fail.js';
import logger from '../utils/logger.js';
import { getPca } from '../utils/pca.js';
import { getZidForRid, getZidForUuid, getZinvite } from '../utils/zinvite.js';
import { getXids } from './math.js';
const sep = '\n';
export const formatEscapedText = (s) => `"${s.replace(/"/g, '""')}"`;
export function formatCSVHeaders(colFns) {
  return Object.keys(colFns).join(',');
}
export function formatCSVRow(row, colFns) {
  const fns = Object.values(colFns);
  let csv = '';
  for (let ii = 0; ii < fns.length; ii += 1) {
    if (ii > 0) csv += ',';
    csv += fns[ii](row);
  }
  return csv;
}
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
export async function loadConversationSummary(zid, siteUrl) {
  const [zinvite, convoRows, commentersRow, pca] = await Promise.all([
    getZinvite(zid),
    pgQueryP_readOnly('SELECT topic, description FROM conversations WHERE zid = $1', [zid]),
    pgQueryP_readOnly('SELECT COUNT(DISTINCT pid) FROM comments WHERE zid = $1', [zid]),
    getPca(zid)
  ]);
  if (!zinvite || !convoRows || !commentersRow || !pca) {
    throw new Error('polis_error_data_unknown_report');
  }

  const convo = convoRows[0];
  const commenters = commentersRow[0].count;

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
export const formatDatetime = (timestamp) => new Date(Number.parseInt(timestamp)).toString();
export async function sendConversationSummary(zid, siteUrl, res) {
  const rows = await loadConversationSummary(zid, siteUrl);
  res.setHeader('content-type', 'text/csv');
  res.send(rows.join(sep));
}
export async function sendCommentSummary(zid, res) {
  const comments = new Map();

  try {
    const commentRows = await pgQueryP_readOnly(
      'SELECT tid, pid, created, txt, mod, velocity, active FROM comments WHERE zid = ($1)',
      [zid]
    );
    for (const comment of commentRows) {
      comment.agrees = 0;
      comment.disagrees = 0;
      comment.pass = 0;
      comments.set(comment.tid, comment);
    }
    stream_pgQueryP_readOnly(
      'SELECT tid, vote FROM votes WHERE zid = ($1) ORDER BY tid',
      [zid],
      (row) => {
        const comment = comments.get(row.tid);
        if (comment) {
          // note that -1 means agree and 1 means disagree
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

        res.setHeader('content-type', 'text/csv');
        res.send(
          formatCSV(
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
          )
        );
      },
      (error) => {
        logger.error('polis_err_report_comments', error);
      }
    );
  } catch (err) {
    logger.error('polis_err_report_comments', err);
    fail(res, 500, 'polis_err_data_export', err);
  }
}
export async function sendVotesSummary(zid, res) {
  const formatters = {
    timestamp: (row) => String(Math.floor(row.timestamp / 1000)),
    datetime: (row) => formatDatetime(row.timestamp),
    'comment-id': (row) => String(row.tid),
    'voter-id': (row) => String(row.pid),
    vote: (row) => String(-row.vote) // have to flip -1 to 1 and vice versa
  };
  res.setHeader('Content-Type', 'text/csv');
  res.write(formatCSVHeaders(formatters) + sep);
  stream_pgQueryP_readOnly(
    'SELECT created as timestamp, tid, pid, vote FROM votes WHERE zid = $1 ORDER BY tid, pid',
    [zid],
    (row) => res.write(formatCSVRow(row, formatters) + sep),
    () => res.end(),
    (error) => {
      // Handle any errors
      logger.error('polis_err_report_votes_csv', error);
      fail(res, 500, 'polis_err_data_export', error);
    }
  );
}
export async function sendParticipantVotesSummary(zid, res) {
  const commentRows = await pgQueryP_readOnly(
    'SELECT tid, pid FROM comments WHERE zid = ($1) ORDER BY tid ASC, created ASC',
    [zid]
  );
  const commentIds = commentRows.map((row) => row.tid);
  const participantCommentCounts = new Map();
  for (const row of commentRows) {
    const count = participantCommentCounts.get(row.pid) || 0;
    participantCommentCounts.set(row.pid, count + 1);
  }

  const pca = await getPca(zid);

  // Define the getGroupId function
  function getGroupId(pca, pid) {
    if (!pca || !pca.asPOJO) {
      return undefined;
    }

    const pcaData = pca.asPOJO;

    // Check if participant is in the conversation
    const inConv = pcaData['in-conv'];
    if (!inConv || !Array.isArray(inConv) || !inConv.includes(pid)) {
      logger.info(`Participant ${pid} not found in in-conv array`);
      return undefined;
    }

    // Get the base clusters and group clusters
    const baseClusters = pcaData['base-clusters'];
    const groupClusters = pcaData['group-clusters'];

    if (!baseClusters || !baseClusters.members || !Array.isArray(baseClusters.members)) {
      logger.info('No base clusters found in PCA data');
      return undefined;
    }

    if (!groupClusters || !Array.isArray(groupClusters) || groupClusters.length === 0) {
      logger.info('No group clusters found in PCA data');
      return undefined;
    }

    // Step 1: Find which base cluster contains the participant
    let baseClusterId = -1;
    for (let i = 0; i < baseClusters.members.length; i++) {
      const members = baseClusters.members[i];
      if (Array.isArray(members) && members.includes(pid)) {
        baseClusterId = i;
        break;
      }
    }

    if (baseClusterId === -1) {
      // We couldn't find the participant in any base cluster
      logger.info(`Could not find base cluster for participant ${pid}`);
      return undefined;
    }

    // Step 2: Find which group cluster contains this base cluster
    for (const groupCluster of groupClusters) {
      if (groupCluster.members && Array.isArray(groupCluster.members) && groupCluster.members.includes(baseClusterId)) {
        return groupCluster.id;
      }
    }

    // We couldn't find the participant in any group cluster
    logger.info(`Could not find group cluster for participant ${pid}`);
    return undefined;
  }

  res.setHeader('content-type', 'text/csv');
  res.write(
    ['participant', 'group-id', 'n-comments', 'n-votes', 'n-agree', 'n-disagree', ...commentIds].join(',') + sep
  );

  // Query the votes in participant order so that we can summarize them in a streaming pass
  let currentParticipantId = -1;
  const currentParticipantVotes = new Map();

  function sendCurrentParticipantRow() {
    let agrees = 0;
    let disagrees = 0;
    for (const vote of currentParticipantVotes.values()) {
      if (vote === 1) agrees += 1;
      else if (vote === -1) disagrees += 1;
    }
    const values = [
      currentParticipantId,
      getGroupId(pca, currentParticipantId),
      participantCommentCounts.get(currentParticipantId) || 0,
      currentParticipantVotes.size,
      agrees,
      disagrees,
      ...commentIds.map((tid) => currentParticipantVotes.get(tid))
    ];
    res.write(values.map((value) => (value === undefined ? '' : String(value))).join(',') + sep);
  }
  stream_pgQueryP_readOnly(
    'SELECT pid, tid, vote FROM votes WHERE zid = ($1) ORDER BY pid',
    [zid],
    (row) => {
      const pid = row.pid;
      if (pid !== currentParticipantId) {
        if (currentParticipantId !== -1) {
          sendCurrentParticipantRow();
        }
        currentParticipantId = pid;
        currentParticipantVotes.clear();
      }
      // have to flip vote from -1 to 1 and vice versa
      currentParticipantVotes.set(row.tid, -row.vote);
    },
    () => {
      if (currentParticipantId !== -1) {
        sendCurrentParticipantRow();
      }
      res.end();
    },
    (error) => {
      logger.error('polis_err_report_participant_votes', error);
      fail(res, 500, 'polis_err_data_export', error);
    }
  );
}

export async function sendCommentGroupsSummary(zid, res, http, filterFN) {
  const csvText = [];
  // Get PCA data to identify groups and get groupVotes
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

  // Load comment texts
  const commentRows = await pg.queryP_readOnly('SELECT tid, txt FROM comments WHERE zid = ($1)', [zid]);
  const commentTexts = new Map(commentRows.map((row) => [row.tid, row.txt]));

  // Initialize stats map
  const commentStats = new Map();

  // Create a mapping of tid to extremity index using math tids array
  const tidToExtremityIndex = new Map();
  const mathTids = pca.asPOJO.tids || []; // Array of tids in same order as extremity values
  commentExtremity.forEach((_extremity, index) => {
    const tid = mathTids[index];
    if (tid !== undefined) {
      tidToExtremityIndex.set(tid, index);
    }
  });

  // Process each group's votes
  for (const groupId of groupIds) {
    const groupVoteStats = groupVotes[groupId];
    if (!groupVoteStats?.votes) continue;

    // Process each comment's votes for this group
    for (const [tidStr, votes] of Object.entries(groupVoteStats.votes)) {
      const tid = Number.parseInt(tidStr);

      // Initialize stats for this comment if we haven't seen it before
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

      // Get the stats object for this comment
      const stats = commentStats.get(tid);
      if (!stats) {
        logger.warn(`Comment stats not found for tid ${tid}`);
        continue;
      }
      const groupStats = stats.group_stats[groupId];

      // Update group stats
      groupStats.agrees = votes.A;
      groupStats.disagrees = votes.D;
      groupStats.votes = votes.S; // S is the total number of votes
      groupStats.passes = votes.S - (votes.A + votes.D); // Calculate passes from the sum
    }
  }

  // Calculate totals for each comment
  for (const stats of commentStats.values()) {
    stats.total_agrees = Object.values(stats.group_stats).reduce((sum, g) => sum + g.agrees, 0);
    stats.total_disagrees = Object.values(stats.group_stats).reduce((sum, g) => sum + g.disagrees, 0);
    stats.total_passes = Object.values(stats.group_stats).reduce((sum, g) => sum + g.passes, 0);
    stats.total_votes = Object.values(stats.group_stats).reduce((sum, g) => sum + g.votes, 0);
  }

  // Format and send CSV
  if (res && http) {
    res.setHeader('content-type', 'text/csv');
  }

  // Create headers
  const headers = ['comment-id', 'comment', 'total-votes', 'total-agrees', 'total-disagrees', 'total-passes'];

  for (const groupId of groupIds) {
    const groupLetter = String.fromCharCode(97 + groupId); // 97 is 'a' in ASCII
    headers.push(
      `group-${groupLetter}-votes`,
      `group-${groupLetter}-agrees`,
      `group-${groupLetter}-disagrees`,
      `group-${groupLetter}-passes`
    );
  }
  if (http && res) {
    res.write(headers.join(',') + sep);
  } else {
    csvText.push(headers.join(',') + sep);
  }

  // Write data rows
  for (const stats of commentStats.values()) {
    const row = [
      stats.tid,
      formatEscapedText(stats.txt),
      stats.total_votes,
      stats.total_agrees,
      stats.total_disagrees,
      stats.total_passes
    ];
    for (const groupId of groupIds) {
      const groupStats = stats.group_stats[groupId];
      row.push(groupStats.votes, groupStats.agrees, groupStats.disagrees, groupStats.passes);
    }
    const shouldIncludeRow =
      filterFN === undefined ||
      filterFN({
        votes: stats.total_votes,
        agrees: stats.total_agrees,
        disagrees: stats.total_disagrees,
        passes: stats.total_passes,
        group_aware_consensus: groupAwareConsensus[stats.tid],
        comment_extremity: commentExtremity[tidToExtremityIndex.get(stats.tid)],
        comment_id: stats.tid,
        num_groups: numGroups
      }) === true;

    const rowString = row.join(',') + sep;

    if (shouldIncludeRow) {
      if (http && res) {
        res.write(rowString);
      } else {
        csvText.push(rowString);
      }
    }
  }

  if (http && res) {
    res.end();
  } else {
    return csvText.join('');
  }
}

export async function sendParticipantXidsSummary(zid, res) {
  try {
    const pca = await getPca(zid);
    if (!pca?.asPOJO) {
      throw new Error('polis_error_no_pca_data');
    }

    const xids = await getXids(zid);
    if (!xids) {
      throw new Error('polis_error_no_xid_response');
    }

    // Sort xids by pid
    xids.sort((a, b) => a.pid - b.pid);

    // Define formatters for the CSV columns
    const formatters = {
      participant: (row) => String(row.pid),
      xid: (row) => formatEscapedText(row.xid)
    };

    // Generate and send the CSV
    res.setHeader('content-type', 'text/csv');
    res.send(formatCSV(formatters, xids));
  } catch (err) {
    logger.error('polis_err_report_participant_xids', err);
    fail(res, 500, 'polis_err_data_export', err);
  }
}

export async function handle_GET_reportExport(req, res) {
  const { rid, report_type } = req.p;
  try {
    const zid = await getZidForRid(rid);
    if (!zid) {
      fail(res, 404, 'polis_error_data_unknown_report');
      return;
    }

    switch (report_type) {
      case 'summary.csv': {
        const siteUrl = `${req.headers['x-forwarded-proto']}://${req.headers.host}`;
        await sendConversationSummary(zid, siteUrl, res);
        break;
      }
      case 'comments.csv':
        await sendCommentSummary(zid, res);
        break;

      case 'votes.csv':
        await sendVotesSummary(zid, res);
        break;

      case 'participant-votes.csv':
        await sendParticipantVotesSummary(zid, res);
        break;

      case 'comment-groups.csv':
        await sendCommentGroupsSummary(zid, res);
        break;

      default:
        fail(res, 404, 'polis_error_data_unknown_report');
        break;
    }
  } catch (err) {
    const msg =
      err instanceof Error && err.message && err.message.startsWith('polis_') ? err.message : 'polis_err_data_export';
    fail(res, 500, msg, err);
  }
}

export async function handle_GET_xidReport(req, res) {
  const { xid_report } = req.p;
  try {
    const uuid = xid_report.split('-xid.csv')[0];
    const zid = await getZidForUuid(uuid);
    if (zid != null) {
      await sendParticipantXidsSummary(zid, res);
    } else {
      fail(res, 404, 'polis_error_data_unknown_report');
    }
  } catch (err) {
    logger.error('polis_err_report_xid', err);
    fail(res, 500, 'polis_err_data_export', err);
  }
}
