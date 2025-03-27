import _ from 'underscore';
import Conversation from '../conversation.js';
import {
  query as pgQuery,
  queryP_readOnly as pgQueryP_readOnly,
  query_readOnly as pgQuery_readOnly
} from '../db/pg-query.js';
import SQL from '../db/sql.js';
import { isDuplicateKey } from '../utils/common.js';
import logger from '../utils/logger.js';
const isXidWhitelisted = Conversation.isXidWhitelisted;
const sql_votes_latest_unique = SQL.sql_votes_latest_unique;
function doVotesPost(_uid, pid, conv, tid, voteType, weight, high_priority) {
  const zid = conv?.zid;
  weight = weight || 0;
  const weight_x_32767 = Math.trunc(weight * 32767);
  return new Promise((resolve, reject) => {
    const query =
      'INSERT INTO votes (pid, zid, tid, vote, weight_x_32767, high_priority, created) VALUES ($1, $2, $3, $4, $5, $6, default) RETURNING *;';
    const params = [pid, zid, tid, voteType, weight_x_32767, high_priority];
    pgQuery(query, params, (err, result) => {
      if (err) {
        if (isDuplicateKey(err)) {
          reject('polis_err_vote_duplicate');
        } else {
          logger.error('polis_err_vote_other', err);
          reject('polis_err_vote_other');
        }
        return;
      }
      const vote = result.rows[0];
      resolve({
        conv: conv,
        vote: vote
      });
    });
  });
}
function votesPost(uid, pid, zid, tid, xid, voteType, weight, high_priority) {
  return pgQueryP_readOnly('select * from conversations where zid = ($1);', [zid])
    .then((rows) => {
      if (!rows || !rows.length) {
        throw 'polis_err_unknown_conversation';
      }
      const conv = rows[0];
      if (!conv.is_active) {
        throw 'polis_err_conversation_is_closed';
      }
      if (conv.use_xid_whitelist) {
        return isXidWhitelisted(conv.owner, xid).then((is_whitelisted) => {
          if (is_whitelisted) {
            return conv;
          }
          throw 'polis_err_xid_not_whitelisted';
        });
      }
      return conv;
    })
    .then((conv) => doVotesPost(uid, pid, conv, tid, voteType, weight, high_priority));
}
function getVotesForSingleParticipant(p) {
  if (_.isUndefined(p.pid)) {
    return Promise.resolve([]);
  }
  return votesGet(p);
}
function votesGet(p) {
  return new MPromise('votesGet', (resolve, reject) => {
    let q = sql_votes_latest_unique
      .select(sql_votes_latest_unique.star())
      .where(sql_votes_latest_unique.zid.equals(p.zid));
    if (!_.isUndefined(p.pid)) {
      q = q.where(sql_votes_latest_unique.pid.equals(p.pid));
    }
    if (!_.isUndefined(p.tid)) {
      q = q.where(sql_votes_latest_unique.tid.equals(p.tid));
    }
    pgQuery_readOnly(q.toString(), (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results.rows);
      }
    });
  });
}
export { votesGet, getVotesForSingleParticipant, votesPost, doVotesPost };
