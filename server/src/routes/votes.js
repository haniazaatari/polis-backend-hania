import _ from 'underscore';
import {
  query as pgQuery,
  query_readOnly as pgQuery_readOnly,
  queryP_readOnly as pgQueryP_readOnly
} from '../db/pg-query';
import { isDuplicateKey } from '../utils/common';
import logger from '../utils/logger';
import Conversation from '../conversation';
import SQL from '../db/sql';
import { MPromise } from '../utils/metered';

const isXidWhitelisted = Conversation.isXidWhitelisted;
const sql_votes_latest_unique = SQL.sql_votes_latest_unique;

function doVotesPost(uid, pid, conv, tid, voteType, weight, high_priority) {
  let zid = conv?.zid;
  weight = weight || 0;
  let weight_x_32767 = Math.trunc(weight * 32767);
  return new Promise(function (resolve, reject) {
    let query =
      'INSERT INTO votes (pid, zid, tid, vote, weight_x_32767, high_priority, created) VALUES ($1, $2, $3, $4, $5, $6, default) RETURNING *;';
    let params = [pid, zid, tid, voteType, weight_x_32767, high_priority];
    pgQuery(query, params, function (err, result) {
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
    .then(function (rows) {
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
          } else {
            throw 'polis_err_xid_not_whitelisted';
          }
        });
      }
      return conv;
    })
    .then(function (conv) {
      return doVotesPost(uid, pid, conv, tid, voteType, weight, high_priority);
    });
}
function getVotesForSingleParticipant(p) {
  if (_.isUndefined(p.pid)) {
    return Promise.resolve([]);
  }
  return votesGet(p);
}

function votesGet(p) {
  return new MPromise('votesGet', function (resolve, reject) {
    let q = sql_votes_latest_unique
      .select(sql_votes_latest_unique.star())
      .where(sql_votes_latest_unique.zid.equals(p.zid));

    if (!_.isUndefined(p.pid)) {
      q = q.where(sql_votes_latest_unique.pid.equals(p.pid));
    }
    if (!_.isUndefined(p.tid)) {
      q = q.where(sql_votes_latest_unique.tid.equals(p.tid));
    }
    pgQuery_readOnly(q.toString(), function (err, results) {
      if (err) {
        reject(err);
      } else {
        resolve(results.rows);
      }
    });
  });
}

export { votesGet, getVotesForSingleParticipant, votesPost, doVotesPost };
