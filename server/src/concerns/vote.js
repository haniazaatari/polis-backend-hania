import _ from 'underscore';
import { queryP, query_readOnly } from '../db/pg-query.js';
import { getVotesForSingleParticipant, votesPost } from '../routes/votes.js';
import { getPid } from '../user.js';
import { isDuplicateKey, polisTypes } from '../utils/common.js';
import { COOKIES, getPermanentCookieAndEnsureItIsSet } from '../utils/cookies.js';
import { fail } from '../utils/fail.js';
import logger from '../utils/logger.js';
import { addNoMoreCommentsRecord, getNextComment } from './comment.js';
import {
  updateConversationModifiedTime,
  updateLastInteractionTimeForConversation,
  updateVoteCount
} from './conversation.js';
import { addParticipant, addParticipantAndMetadata } from './participant.js';
import { finishArray, finishOne } from './response.js';

function addStar(zid, tid, pid, starred, created) {
  starred = starred ? 1 : 0;
  let query = 'INSERT INTO stars (pid, zid, tid, starred, created) VALUES ($1, $2, $3, $4, default) RETURNING created;';
  const params = [pid, zid, tid, starred];
  if (!_.isUndefined(created)) {
    query = 'INSERT INTO stars (pid, zid, tid, starred, created) VALUES ($1, $2, $3, $4, $5) RETURNING created;';
    params.push(created);
  }
  return queryP(query, params);
}

function handle_POST_stars(req, res) {
  addStar(req.p.zid, req.p.tid, req.p.pid, req.p.starred)
    .then((result) => {
      const createdTime = result.rows[0].created;
      setTimeout(() => {
        updateConversationModifiedTime(req.p.zid, createdTime);
      }, 100);
      res.status(200).json({});
    })
    .catch((err) => {
      if (err) {
        if (isDuplicateKey(err)) {
          fail(res, 406, 'polis_err_vote_duplicate', err);
        } else {
          fail(res, 500, 'polis_err_vote', err);
        }
      }
    });
}

// Note: This function currently does not work as expected.
// It fails to attach the pid to req.p before running the query.
// So it returns an empty array.
function handle_GET_votes_me(req, res) {
  getPid(req.p.zid, req.p.uid, (err, pid) => {
    if (err || pid < 0) {
      fail(res, 500, 'polis_err_getting_pid', err);
      return;
    }
    query_readOnly('SELECT * FROM votes WHERE zid = ($1) AND pid = ($2);', [req.p.zid, req.p.pid], (err, docs) => {
      if (err) {
        fail(res, 500, 'polis_err_get_votes_by_me', err);
        return;
      }
      for (let i = 0; i < docs.rows.length; i++) {
        docs.rows[i].weight = docs.rows[i].weight / 32767;
      }
      finishArray(res, docs.rows);
    });
  });
}

function handle_GET_votes(req, res) {
  getVotesForSingleParticipant(req.p).then(
    (votes) => {
      finishArray(res, votes);
    },
    (err) => {
      fail(res, 500, 'polis_err_votes_get', err);
    }
  );
}

function handle_POST_votes(req, res) {
  const uid = req.p.uid;
  const zid = req.p.zid;
  let pid = req.p.pid;
  const lang = req.p.lang;
  const token = req.cookies[COOKIES.TOKEN];
  const apiToken = req?.headers?.authorization || '';
  const xPolisHeaderToken = req?.headers?.['x-polis'];
  if (!uid && !token && !apiToken && !xPolisHeaderToken) {
    fail(res, 403, 'polis_err_vote_noauth');
    return;
  }
  const permanent_cookie = getPermanentCookieAndEnsureItIsSet(req, res);
  const pidReadyPromise = _.isUndefined(req.p.pid)
    ? addParticipantAndMetadata(req.p.zid, req.p.uid, req, permanent_cookie).then((rows) => {
        const ptpt = rows[0];
        pid = ptpt.pid;
      })
    : Promise.resolve();
  pidReadyPromise
    .then(() => {
      let vote;
      const pidReadyPromise = _.isUndefined(pid)
        ? addParticipant(zid, uid).then((rows) => {
            const ptpt = rows[0];
            pid = ptpt.pid;
          })
        : Promise.resolve();
      return pidReadyPromise
        .then(() => votesPost(uid, pid, zid, req.p.tid, req.p.xid, req.p.vote, req.p.weight, req.p.high_priority))
        .then((o) => {
          vote = o.vote;
          const createdTime = vote.created;
          setTimeout(() => {
            updateConversationModifiedTime(zid, createdTime);
            updateLastInteractionTimeForConversation(zid, uid);
            updateVoteCount(zid, pid);
          }, 100);
          if (_.isUndefined(req.p.starred)) {
            return;
          }
          return addStar(zid, req.p.tid, pid, req.p.starred, createdTime);
        })
        .then(() => getNextComment(zid, pid, [], true, lang))
        .then((nextComment) => {
          logger.debug('handle_POST_votes nextComment:', {
            zid,
            pid,
            nextComment
          });
          const result = {};
          if (nextComment) {
            result.nextComment = nextComment;
          } else {
            addNoMoreCommentsRecord(zid, pid);
          }
          result.currentPid = pid;
          if (result.shouldMod) {
            result.modOptions = {};
            if (req.p.vote === polisTypes.reactions.pull) {
              result.modOptions.as_important = true;
              result.modOptions.as_factual = true;
              result.modOptions.as_feeling = true;
            } else if (req.p.vote === polisTypes.reactions.push) {
              result.modOptions.as_notmyfeeling = true;
              result.modOptions.as_notgoodidea = true;
              result.modOptions.as_notfact = true;
              result.modOptions.as_abusive = true;
            } else if (req.p.vote === polisTypes.reactions.pass) {
              result.modOptions.as_unsure = true;
              result.modOptions.as_spam = true;
              result.modOptions.as_abusive = true;
            }
          }
          finishOne(res, result);
        });
    })
    .catch((err) => {
      if (err === 'polis_err_vote_duplicate') {
        fail(res, 406, 'polis_err_vote_duplicate', err);
      } else if (err === 'polis_err_conversation_is_closed') {
        fail(res, 403, 'polis_err_conversation_is_closed', err);
      } else if (err === 'polis_err_post_votes_social_needed') {
        fail(res, 403, 'polis_err_post_votes_social_needed', err);
      } else if (err === 'polis_err_xid_not_whitelisted') {
        fail(res, 403, 'polis_err_xid_not_whitelisted', err);
      } else {
        fail(res, 500, 'polis_err_vote', err);
      }
    });
}

function handle_POST_upvotes(req, res) {
  const uid = req.p.uid;
  const zid = req.p.zid;
  queryP('select * from upvotes where uid = ($1) and zid = ($2);', [uid, zid]).then(
    (rows) => {
      if (rows?.length) {
        fail(res, 403, 'polis_err_upvote_already_upvoted');
      } else {
        queryP('insert into upvotes (uid, zid) VALUES ($1, $2);', [uid, zid]).then(
          () => {
            queryP(
              'update conversations set upvotes = (select count(*) from upvotes where zid = ($1)) where zid = ($1);',
              [zid]
            ).then(
              () => {
                res.status(200).json({});
              },
              (err) => {
                fail(res, 500, 'polis_err_upvote_update', err);
              }
            );
          },
          (err) => {
            fail(res, 500, 'polis_err_upvote_insert', err);
          }
        );
      }
    },
    (err) => {
      fail(res, 500, 'polis_err_upvote_check', err);
    }
  );
}

export { handle_GET_votes_me, handle_GET_votes, handle_POST_stars, handle_POST_votes, handle_POST_upvotes };
