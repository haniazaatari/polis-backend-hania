import _ from 'underscore';
import { getConversationInfo } from '../services/conversation/conversationService.js';
import logger from '../utils/logger.js';
import { MPromise } from '../utils/metered.js';
import polisTypes from '../utils/polisTypes.js';
import { pgQueryP_readOnly, queryP } from './pg-query.js';

/**
 * Get the number of comments with a specific moderation status
 * @param {number} zid - The conversation ID
 * @param {number} mod - The moderation status
 * @returns {Promise<number>} - The number of comments
 */
function getNumberOfCommentsWithModerationStatus(zid, mod) {
  return MPromise('getNumberOfCommentsWithModerationStatus', (resolve, reject) => {
    pgQueryP_readOnly('SELECT COUNT(*) FROM comments WHERE zid = ($1) AND mod = ($2);', [zid, mod])
      .then((result) => {
        let count = result?.[0]?.count;
        count = Number(count);
        if (Number.isNaN(count)) {
          count = undefined;
        }
        resolve(count);
      })
      .catch((err) => {
        reject(err);
      });
  });
}

/**
 * Get comments for a conversation
 * @param {Object} o - Query options
 * @param {number} o.zid - Conversation ID
 * @param {number} [o.pid] - Participant ID
 * @param {Array<number>} [o.tids] - Comment IDs to include
 * @param {Array<number>} [o.withoutTids] - Comment IDs to exclude
 * @param {number} [o.mod] - Moderation status
 * @param {number} [o.not_voted_by_pid] - Exclude comments voted by this participant
 * @param {boolean} [o.random] - Return comments in random order
 * @param {number} [o.limit] - Maximum number of comments to return
 * @param {boolean} [o.moderation] - Get comments for moderation
 * @returns {Promise<Array>} - Comments
 */
function getComments(o) {
  return MPromise('getComments', (resolve, reject) => {
    getConversationInfo(o.zid)
      .then((conv) => {
        let q = 'SELECT * FROM comments WHERE zid = ($1)';
        const params = [o.zid];
        let paramIndex = 1;

        if (!_.isUndefined(o.pid)) {
          paramIndex += 1;
          q += ` AND pid = ($${paramIndex})`;
          params.push(o.pid);
        }

        if (!_.isUndefined(o.tids)) {
          q += ' AND tid IN (';
          for (let i = 0; i < o.tids.length; i++) {
            paramIndex += 1;
            q += `$${paramIndex}`;
            params.push(o.tids[i]);
            if (i < o.tids.length - 1) {
              q += ',';
            }
          }
          q += ')';
        }

        if (!_.isUndefined(o.mod)) {
          paramIndex += 1;
          q += ` AND mod = ($${paramIndex})`;
          params.push(o.mod);
        }

        if (!_.isUndefined(o.not_voted_by_pid)) {
          paramIndex += 1;
          q += ` AND tid NOT IN (SELECT tid FROM votes_latest_unique WHERE zid = ($1) AND pid = ($${paramIndex}))`;
          params.push(o.not_voted_by_pid);
        }

        if (!_.isUndefined(o.withoutTids) && o.withoutTids.length) {
          q += ' AND tid NOT IN (';
          for (let i = 0; i < o.withoutTids.length; i++) {
            paramIndex += 1;
            q += `$${paramIndex}`;
            params.push(o.withoutTids[i]);
            if (i < o.withoutTids.length - 1) {
              q += ',';
            }
          }
          q += ')';
        }

        if (o.moderation) {
          // Moderators can see hidden comments
        } else {
          q += ' AND active = TRUE';
          if (conv.strict_moderation) {
            q += ` AND mod = ${polisTypes.mod.ok}`;
          } else {
            q += ` AND mod <> ${polisTypes.mod.ban}`;
          }
          q += ' AND velocity > 0';
        }

        if (!_.isUndefined(o.random) && o.random) {
          if (conv.prioritize_seed) {
            q += ' ORDER BY is_seed DESC, RANDOM()';
          } else {
            q += ' ORDER BY RANDOM()';
          }
        } else {
          q += ' ORDER BY created';
        }

        if (!_.isUndefined(o.limit)) {
          paramIndex += 1;
          q += ` LIMIT ($${paramIndex})`;
          params.push(o.limit);
        }

        return pgQueryP_readOnly(q, params);
      })
      .then((comments) => {
        const cols = ['txt', 'tid', 'created', 'uid', 'quote_src_url', 'anon', 'is_seed', 'is_meta', 'lang', 'pid'];

        if (o.moderation) {
          cols.push('velocity');
          cols.push('zid');
          cols.push('mod');
          cols.push('active');
          cols.push('agree_count');
          cols.push('disagree_count');
          cols.push('pass_count');
          cols.push('count');
        }

        const formattedComments = comments.map((comment) => {
          const formattedComment = _.pick(comment, cols);

          if (formattedComment.count !== undefined) {
            formattedComment.count = Number(formattedComment.count);
          }

          return formattedComment;
        });

        // Remove sensitive information
        for (const comment of formattedComments) {
          comment.uid = undefined;
          comment.anon = undefined;
        }

        resolve(formattedComments);
      })
      .catch((err) => {
        logger.error('Error getting comments', err);
        reject(err);
      });
  });
}

/**
 * Add a no more comments record
 * @param {number} zid - The conversation ID
 * @param {number} pid - The participant ID
 * @returns {Promise<void>}
 */
function addNoMoreCommentsRecord(zid, pid) {
  return queryP(
    'insert into event_ptpt_no_more_comments (zid, pid, votes_placed) values ($1, $2, ' +
      '(select count(*) from votes where zid = ($1) and pid = ($2)))',
    [zid, pid]
  );
}

export { getNumberOfCommentsWithModerationStatus, getComments, addNoMoreCommentsRecord };
