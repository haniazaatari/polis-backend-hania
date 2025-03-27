import akismetLib from 'akismet';
import async from 'async';
import AWS from 'aws-sdk';
import { Promise as BluebirdPromise } from 'bluebird';
import timeout from 'connect-timeout';
import _ from 'underscore';
import CreateUser from './auth/create-user.js';
import Password from './auth/password.js';
import Comment from './comment.js';
import Config from './config.js';
import {
  query as pgQuery,
  queryP as pgQueryP,
  queryP_readOnly as pgQueryP_readOnly,
  query_readOnly as pgQuery_readOnly
} from './db/pg-query.js';
import SQL from './db/sql.js';
import { handle_GET_dataExport, handle_GET_dataExport_results } from './routes/dataExport.js';
import { handle_GET_reportExport } from './routes/export.js';
import handle_GET_launchPrep from './routes/launchPrep.js';
import {
  handle_GET_bid,
  handle_GET_bidToPid,
  handle_GET_math_correlationMatrix,
  handle_GET_math_pca,
  handle_GET_math_pca2,
  handle_GET_xids,
  handle_POST_math_update,
  handle_POST_xidWhitelist
} from './routes/math.js';
import handle_DELETE_metadata_answers from './routes/metadataAnswers.js';
import { handle_POST_auth_password, handle_POST_auth_pwresettoken } from './routes/password.js';
import { handle_GET_reportNarrative } from './routes/reportNarrative.js';
import handle_GET_tryCookie from './routes/tryCookie.js';
import { getVotesForSingleParticipant, votesPost } from './routes/votes.js';
import User from './user.js';
import Utils from './utils/common.js';
import cookies from './utils/cookies.js';
import fail from './utils/fail.js';
import logger from './utils/logger.js';
import { METRICS_IN_RAM } from './utils/metered.js';
import { getPidsForGid } from './utils/participants.js';
import { fetchAndCacheLatestPcaData } from './utils/pca.js';

import { addNoMoreCommentsRecord, getNextComment } from './icebergs/comment.js';
import {
  updateConversationModifiedTime,
  updateLastInteractionTimeForConversation,
  updateVoteCount
} from './icebergs/conversation.js';
import { doSendEinvite, emailBadProblemTime, emailFeatureRequest, emailTeam, sendTextEmail } from './icebergs/email.js';
import { doNotificationLoop } from './icebergs/notification.js';
import { addParticipant, addParticipantAndMetadata } from './icebergs/participant.js';
import { finishArray, finishOne } from './icebergs/response.js';

const COOKIES = cookies.COOKIES;
const detectLanguage = Comment.detectLanguage;
const devMode = Config.isDevMode;
const generateAndRegisterZinvite = CreateUser.generateAndRegisterZinvite;
const generateTokenP = Password.generateTokenP;
const getPermanentCookieAndEnsureItIsSet = cookies.getPermanentCookieAndEnsureItIsSet;
const getPid = User.getPid;
const getPidForParticipant = User.getPidForParticipant;
const getUser = User.getUser;
const HMAC_SIGNATURE_PARAM_NAME = 'signature';
const isModerator = Utils.isModerator;
const isPolisDev = Utils.isPolisDev;
const pidCache = User.pidCache;
const polisTypes = Utils.polisTypes;
const isConversationOwner = Utils.isConversationOwner;
const serverUrl = Config.getServerUrl();
const shouldSendNotifications = !devMode;
const sql_participant_metadata_answers = SQL.sql_participant_metadata_answers;
const sql_reports = SQL.sql_reports;
const sql_users = SQL.sql_users;

const akismet = akismetLib.client({
  blog: serverUrl,
  apiKey: Config.akismetAntispamApiKey
});

AWS.config.update({ region: Config.awsRegion });

if (devMode) {
  BluebirdPromise.longStackTraces();
}

BluebirdPromise.onPossiblyUnhandledRejection((err) => {
  logger.error('onPossiblyUnhandledRejection', err);
});

akismet.verifyKey((_err, verified) => {
  if (verified) {
    logger.debug('Akismet: API key successfully verified.');
  } else {
    logger.debug('Akismet: Unable to verify API key.');
  }
});
function haltOnTimeout(req, res, next) {
  if (req.timedout) {
    fail(res, 500, 'polis_err_timeout_misc');
  } else {
    next();
  }
}
String.prototype.hashCode = function () {
  let hash = 0;
  let i;
  let character;
  if (this.length === 0) {
    return hash;
  }
  for (i = 0; i < this.length; i++) {
    character = this.charCodeAt(i);
    hash = (hash << 5) - hash + character;
    hash = hash & hash;
  }
  return hash;
};
function initializePolisHelpers() {
  if (Config.backfillCommentLangDetection) {
    pgQueryP('select tid, txt, zid from comments where lang is null;', []).then((comments) => {
      let i = 0;
      function doNext() {
        if (i < comments.length) {
          const c = comments[i];
          i += 1;
          detectLanguage(c.txt).then((x) => {
            const firstResult = x[0];
            logger.debug(`backfill ${firstResult.language}\t\t${c.txt}`);
            pgQueryP('update comments set lang = ($1), lang_confidence = ($2) where zid = ($3) and tid = ($4)', [
              firstResult.language,
              firstResult.confidence,
              c.zid,
              c.tid
            ]).then(() => {
              doNext();
            });
          });
        }
      }
      doNext();
    });
  }
  function writeDefaultHead(_req, res, next) {
    res.set({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    next();
  }
  function redirectIfNotHttps(req, res, next) {
    if (devMode || req.path === '/api/v3/testConnection' || Config.useNetworkHost) {
      return next();
    }
    const isHttps = req.headers['x-forwarded-proto'] === 'https';
    if (!isHttps) {
      logger.debug('redirecting to https', { headers: req.headers });
      if (req.method === 'GET') {
        res.writeHead(302, {
          Location: `https://${req.headers.host}${req.url}`
        });
        return res.end();
      }
      res.status(400).send('Please use HTTPS when submitting data.');
    }
    return next();
  }
  fetchAndCacheLatestPcaData();
  function redirectIfHasZidButNoConversationId(req, res, next) {
    if (req.body.zid && !req.body.conversation_id) {
      logger.info('redirecting old zid user to about page');
      const path = '/about';
      const protocol = req.headers['x-forwarded-proto'] || 'http';
      res.writeHead(302, {
        Location: `${protocol}://${req?.headers?.host}${path}`
      });
      return res.end();
    }
    return next();
  }
  function doAddDataExportTask(math_env, email, zid, atDate, format, task_bucket) {
    return pgQueryP(
      "insert into worker_tasks (math_env, task_data, task_type, task_bucket) values ($1, $2, 'generate_export_data', $3);",
      [
        math_env,
        {
          email: email,
          zid: zid,
          'at-date': atDate,
          format: format
        },
        task_bucket
      ]
    );
  }
  if (Config.runPeriodicExportTests && !devMode && Config.mathEnv === 'preprod') {
    const runExportTest = () => {
      const math_env = 'prod';
      const email = Config.adminEmailDataExportTest;
      const zid = 12480;
      const atDate = Date.now();
      const format = 'csv';
      const task_bucket = Math.abs((Math.random() * 999999999999) >> 0);
      doAddDataExportTask(math_env, email, zid, atDate, format, task_bucket).then(() => {
        setTimeout(
          () => {
            pgQueryP("select * from worker_tasks where task_type = 'generate_export_data' and task_bucket = ($1);", [
              task_bucket
            ]).then((rows) => {
              const ok = rows?.length;
              let newOk;
              if (ok) {
                newOk = rows[0].finished_time > 0;
              }
              if (ok && newOk) {
                logger.info('runExportTest success');
              } else {
                logger.error('runExportTest failed');
                emailBadProblemTime("Math export didn't finish.");
              }
            });
          },
          10 * 60 * 1000
        );
      });
    };
    setInterval(runExportTest, 6 * 60 * 60 * 1000);
  }
  function hashStringToInt32(s) {
    let h = 1;
    if (typeof s !== 'string' || !s.length) {
      return 99;
    }
    for (let i = 0; i < s.length; i++) {
      h = h * s.charCodeAt(i) * 31;
    }
    if (h < 0) {
      h = -h;
    }
    while (h > 2147483648) {
      h = h / 2;
    }
    return h;
  }
  function handle_POST_metrics(req, res) {
    const enabled = false;
    if (!enabled) {
      return res.status(200).json({});
    }
    const pc = req.cookies[COOKIES.PERMANENT_COOKIE];
    const hashedPc = hashStringToInt32(pc);
    const uid = req.p.uid || null;
    const durs = req.p.durs.map((dur) => {
      if (dur === -1) {
        dur = null;
      }
      return dur;
    });
    const clientTimestamp = req.p.clientTimestamp;
    const ages = req.p.times.map((t) => clientTimestamp - t);
    const now = Date.now();
    const timesInTermsOfServerTime = ages.map((a) => now - a);
    const len = timesInTermsOfServerTime.length;
    const entries = [];
    for (let i = 0; i < len; i++) {
      entries.push(`(${[uid || 'null', req.p.types[i], durs[i], hashedPc, timesInTermsOfServerTime[i]].join(',')})`);
    }
    pgQueryP(`insert into metrics (uid, type, dur, hashedPc, created) values ${entries.join(',')};`, [])
      .then((_result) => {
        res.json({});
      })
      .catch((err) => {
        fail(res, 500, 'polis_err_metrics_post', err);
      });
  }
  function handle_GET_zinvites(req, res) {
    pgQuery_readOnly(
      'SELECT * FROM conversations WHERE zid = ($1) AND owner = ($2);',
      [req.p.zid, req.p.uid],
      (err, results) => {
        if (err) {
          fail(res, 500, 'polis_err_fetching_zinvite_invalid_conversation_or_owner', err);
          return;
        }
        if (!results || !results.rows) {
          res.writeHead(404);
          res.json({
            status: 404
          });
          return;
        }
        pgQuery_readOnly('SELECT * FROM zinvites WHERE zid = ($1);', [req.p.zid], (err, results) => {
          if (err) {
            fail(res, 500, 'polis_err_fetching_zinvite_invalid_conversation_or_owner_or_something', err);
            return;
          }
          if (!results || !results.rows) {
            res.writeHead(404);
            res.json({
              status: 404
            });
            return;
          }
          res.status(200).json({
            codes: results.rows
          });
        });
      }
    );
  }
  function handle_POST_zinvites(req, res) {
    const generateShortUrl = req.p.short_url;
    pgQuery(
      'SELECT * FROM conversations WHERE zid = ($1) AND owner = ($2);',
      [req.p.zid, req.p.uid],
      (err, _results) => {
        if (err) {
          fail(res, 500, 'polis_err_creating_zinvite_invalid_conversation_or_owner', err);
          return;
        }
        generateAndRegisterZinvite(req.p.zid, generateShortUrl)
          .then((zinvite) => {
            res.status(200).json({
              zinvite: zinvite
            });
          })
          .catch((err) => {
            fail(res, 500, 'polis_err_creating_zinvite', err);
          });
      }
    );
  }
  function checkZinviteCodeValidity(zid, zinvite, callback) {
    pgQuery_readOnly('SELECT * FROM zinvites WHERE zid = ($1) AND zinvite = ($2);', [zid, zinvite], (err, results) => {
      if (err || !results || !results.rows || !results.rows.length) {
        callback(1);
      } else {
        callback(null);
      }
    });
  }
  function checkSuzinviteCodeValidity(zid, suzinvite, callback) {
    pgQuery('SELECT * FROM suzinvites WHERE zid = ($1) AND suzinvite = ($2);', [zid, suzinvite], (err, results) => {
      if (err || !results || !results.rows || !results.rows.length) {
        callback(1);
      } else {
        callback(null);
      }
    });
  }
  function getChoicesForConversation(zid) {
    return new Promise((resolve, reject) => {
      pgQuery_readOnly(
        'select * from participant_metadata_choices where zid = ($1) and alive = TRUE;',
        [zid],
        (err, x) => {
          if (err) {
            reject(err);
            return;
          }
          if (!x || !x.rows) {
            resolve([]);
            return;
          }
          resolve(x.rows);
        }
      );
    });
  }
  function handle_GET_dummyButton(req, res) {
    const message = `${req.p.button} ${req.p.uid}`;
    emailFeatureRequest(message);
    res.status(200).end();
  }
  if (shouldSendNotifications) {
    doNotificationLoop();
  }
  function handle_GET_perfStats(_req, res) {
    res.json(METRICS_IN_RAM);
  }
  function handle_GET_snapshot(req, _res) {
    const _uid = req.p.uid;
    const _zid = req.p.zid;

    throw new Error('TODO Needs to clone participants_extended and any other new tables as well.');
  }
  function handle_POST_tutorial(req, res) {
    const uid = req.p.uid;
    const step = req.p.step;
    pgQueryP('update users set tut = ($1) where uid = ($2);', [step, uid])
      .then(() => {
        res.status(200).json({});
      })
      .catch((err) => {
        fail(res, 500, 'polis_err_saving_tutorial_state', err);
      });
  }
  function handle_GET_users(req, res) {
    const uid = req.p.uid;
    if (req.p.errIfNoAuth && !uid) {
      fail(res, 401, 'polis_error_auth_needed');
      return;
    }
    getUser(uid, null, req.p.xid, req.p.owner_uid)
      .then(
        (user) => {
          res.status(200).json(user);
        },
        (err) => {
          fail(res, 500, 'polis_err_getting_user_info2', err);
        }
      )
      .catch((err) => {
        fail(res, 500, 'polis_err_getting_user_info', err);
      });
  }
  function isDuplicateKey(err) {
    const isdup =
      err.code === 23505 ||
      err.code === '23505' ||
      err.sqlState === 23505 ||
      err.sqlState === '23505' ||
      err.messagePrimary?.includes('duplicate key value');
    return isdup;
  }
  function handle_GET_votes_me(req, res) {
    getPid(req.p.zid, req.p.uid, (err, pid) => {
      if (err || pid < 0) {
        fail(res, 500, 'polis_err_getting_pid', err);
        return;
      }
      pgQuery_readOnly('SELECT * FROM votes WHERE zid = ($1) AND pid = ($2);', [req.p.zid, req.p.pid], (err, docs) => {
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
    pgQueryP('select * from upvotes where uid = ($1) and zid = ($2);', [uid, zid]).then(
      (rows) => {
        if (rows?.length) {
          fail(res, 403, 'polis_err_upvote_already_upvoted');
        } else {
          pgQueryP('insert into upvotes (uid, zid) VALUES ($1, $2);', [uid, zid]).then(
            () => {
              pgQueryP(
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
  function addStar(zid, tid, pid, starred, created) {
    starred = starred ? 1 : 0;
    let query =
      'INSERT INTO stars (pid, zid, tid, starred, created) VALUES ($1, $2, $3, $4, default) RETURNING created;';
    const params = [pid, zid, tid, starred];
    if (!_.isUndefined(created)) {
      query = 'INSERT INTO stars (pid, zid, tid, starred, created) VALUES ($1, $2, $3, $4, $5) RETURNING created;';
      params.push(created);
    }
    return pgQueryP(query, params);
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
  function handle_POST_trashes(req, res) {
    const query = 'INSERT INTO trashes (pid, zid, tid, trashed, created) VALUES ($1, $2, $3, $4, default);';
    const params = [req.p.pid, req.p.zid, req.p.tid, req.p.trashed];
    pgQuery(query, params, (err, result) => {
      if (err) {
        if (isDuplicateKey(err)) {
          fail(res, 406, 'polis_err_vote_duplicate', err);
        } else {
          fail(res, 500, 'polis_err_vote', err);
        }
        return;
      }
      const createdTime = result.rows[0].created;
      setTimeout(() => {
        updateConversationModifiedTime(req.p.zid, createdTime);
      }, 100);
      res.status(200).json({});
    });
  }
  function handle_PUT_users(req, res) {
    let uid = req.p.uid;
    if (isPolisDev(uid) && req.p.uid_of_user) {
      uid = req.p.uid_of_user;
    }
    const fields = {};
    if (!_.isUndefined(req.p.email)) {
      fields.email = req.p.email;
    }
    if (!_.isUndefined(req.p.hname)) {
      fields.hname = req.p.hname;
    }
    const q = sql_users.update(fields).where(sql_users.uid.equals(uid));
    pgQueryP(q.toString(), [])
      .then((result) => {
        res.json(result);
      })
      .catch((err) => {
        fail(res, 500, 'polis_err_put_user', err);
      });
  }
  function handle_DELETE_metadata_questions(req, res) {
    const uid = req.p.uid;
    const pmqid = req.p.pmqid;
    getZidForQuestion(pmqid, (err, zid) => {
      if (err) {
        fail(res, 500, 'polis_err_delete_participant_metadata_questions_zid', err);
        return;
      }
      isConversationOwner(zid, uid, (err) => {
        if (err) {
          fail(res, 403, 'polis_err_delete_participant_metadata_questions_auth', err);
          return;
        }
        deleteMetadataQuestionAndAnswers(pmqid, (err) => {
          if (err) {
            fail(res, 500, 'polis_err_delete_participant_metadata_question', new Error(err));
            return;
          }
          res.send(200);
        });
      });
    });
  }
  function getZidForQuestion(pmqid, callback) {
    pgQuery('SELECT zid FROM participant_metadata_questions WHERE pmqid = ($1);', [pmqid], (err, result) => {
      if (err) {
        logger.error('polis_err_zid_missing_for_question', err);
        callback(err);
        return;
      }
      if (!result.rows || !result.rows.length) {
        callback('polis_err_zid_missing_for_question');
        return;
      }
      callback(null, result.rows[0].zid);
    });
  }
  function deleteMetadataQuestionAndAnswers(pmqid, callback) {
    pgQuery('update participant_metadata_answers set alive = FALSE where pmqid = ($1);', [pmqid], (err) => {
      if (err) {
        callback(err);
        return;
      }
      pgQuery('update participant_metadata_questions set alive = FALSE where pmqid = ($1);', [pmqid], (err) => {
        if (err) {
          callback(err);
          return;
        }
        callback(null);
      });
    });
  }
  function handle_GET_metadata_questions(req, res) {
    const zid = req.p.zid;
    const zinvite = req.p.zinvite;
    const suzinvite = req.p.suzinvite;
    function doneChecking(err, _foo) {
      if (err) {
        fail(res, 403, 'polis_err_get_participant_metadata_auth', err);
        return;
      }
      async.parallel(
        [
          (callback) => {
            pgQuery_readOnly(
              'SELECT * FROM participant_metadata_questions WHERE alive = true AND zid = ($1);',
              [zid],
              callback
            );
          }
        ],
        (err, result) => {
          if (err) {
            fail(res, 500, 'polis_err_get_participant_metadata_questions', err);
            return;
          }
          let rows = result[0]?.rows;
          rows = rows.map((r) => {
            r.required = true;
            return r;
          });
          finishArray(res, rows);
        }
      );
    }
    if (zinvite) {
      checkZinviteCodeValidity(zid, zinvite, doneChecking);
    } else if (suzinvite) {
      checkSuzinviteCodeValidity(zid, suzinvite, doneChecking);
    } else {
      doneChecking(false);
    }
  }
  function handle_POST_metadata_questions(req, res) {
    const zid = req.p.zid;
    const key = req.p.key;
    const uid = req.p.uid;
    function doneChecking(err, _foo) {
      if (err) {
        fail(res, 403, 'polis_err_post_participant_metadata_auth', err);
        return;
      }
      pgQuery(
        'INSERT INTO participant_metadata_questions (pmqid, zid, key) VALUES (default, $1, $2) RETURNING *;',
        [zid, key],
        (err, results) => {
          if (err || !results || !results.rows || !results.rows.length) {
            fail(res, 500, 'polis_err_post_participant_metadata_key', err);
            return;
          }
          finishOne(res, results.rows[0]);
        }
      );
    }
    isConversationOwner(zid, uid, doneChecking);
  }
  function handle_POST_metadata_answers(req, res) {
    const zid = req.p.zid;
    const uid = req.p.uid;
    const pmqid = req.p.pmqid;
    const value = req.p.value;
    function doneChecking(err, _foo) {
      if (err) {
        fail(res, 403, 'polis_err_post_participant_metadata_auth', err);
        return;
      }
      pgQuery(
        'INSERT INTO participant_metadata_answers (pmqid, zid, value, pmaid) VALUES ($1, $2, $3, default) RETURNING *;',
        [pmqid, zid, value],
        (err, results) => {
          if (err || !results || !results.rows || !results.rows.length) {
            pgQuery(
              'UPDATE participant_metadata_answers set alive = TRUE where pmqid = ($1) AND zid = ($2) AND value = ($3) RETURNING *;',
              [pmqid, zid, value],
              (err, results) => {
                if (err) {
                  fail(res, 500, 'polis_err_post_participant_metadata_value', err);
                  return;
                }
                finishOne(res, results.rows[0]);
              }
            );
          } else {
            finishOne(res, results.rows[0]);
          }
        }
      );
    }
    isConversationOwner(zid, uid, doneChecking);
  }
  function handle_GET_metadata_choices(req, res) {
    const zid = req.p.zid;
    getChoicesForConversation(zid).then(
      (choices) => {
        finishArray(res, choices);
      },
      (err) => {
        fail(res, 500, 'polis_err_get_participant_metadata_choices', err);
      }
    );
  }
  function handle_GET_metadata_answers(req, res) {
    const zid = req.p.zid;
    const zinvite = req.p.zinvite;
    const suzinvite = req.p.suzinvite;
    const pmqid = req.p.pmqid;
    function doneChecking(err, _foo) {
      if (err) {
        fail(res, 403, 'polis_err_get_participant_metadata_auth', err);
        return;
      }
      let query = sql_participant_metadata_answers
        .select(sql_participant_metadata_answers.star())
        .where(sql_participant_metadata_answers.zid.equals(zid))
        .and(sql_participant_metadata_answers.alive.equals(true));
      if (pmqid) {
        query = query.where(sql_participant_metadata_answers.pmqid.equals(pmqid));
      }
      pgQuery_readOnly(query.toString(), (err, result) => {
        if (err) {
          fail(res, 500, 'polis_err_get_participant_metadata_answers', err);
          return;
        }
        const rows = result.rows.map((r) => {
          r.is_exclusive = true;
          return r;
        });
        finishArray(res, rows);
      });
    }
    if (zinvite) {
      checkZinviteCodeValidity(zid, zinvite, doneChecking);
    } else if (suzinvite) {
      checkSuzinviteCodeValidity(zid, suzinvite, doneChecking);
    } else {
      doneChecking(false);
    }
  }
  function handle_GET_metadata(req, res) {
    const zid = req.p.zid;
    const zinvite = req.p.zinvite;
    const suzinvite = req.p.suzinvite;
    function doneChecking(err) {
      if (err) {
        fail(res, 403, 'polis_err_get_participant_metadata_auth', err);
        return;
      }
      async.parallel(
        [
          (callback) => {
            pgQuery_readOnly('SELECT * FROM participant_metadata_questions WHERE zid = ($1);', [zid], callback);
          },
          (callback) => {
            pgQuery_readOnly('SELECT * FROM participant_metadata_answers WHERE zid = ($1);', [zid], callback);
          },
          (callback) => {
            pgQuery_readOnly('SELECT * FROM participant_metadata_choices WHERE zid = ($1);', [zid], callback);
          }
        ],
        (err, result) => {
          if (err) {
            fail(res, 500, 'polis_err_get_participant_metadata', err);
            return;
          }
          const keys = result[0]?.rows;
          const vals = result[1]?.rows;
          const choices = result[2]?.rows;
          const o = {};
          const keyNames = {};
          const valueNames = {};
          let i;
          let k;
          let v;
          if (!keys || !keys.length) {
            res.status(200).json({});
            return;
          }
          for (i = 0; i < keys.length; i++) {
            k = keys[i];
            o[k.pmqid] = {};
            keyNames[k.pmqid] = k.key;
          }
          for (i = 0; i < vals.length; i++) {
            k = vals[i];
            v = vals[i];
            o[k.pmqid][v.pmaid] = [];
            valueNames[v.pmaid] = v.value;
          }
          for (i = 0; i < choices.length; i++) {
            o[choices[i].pmqid][choices[i].pmaid] = choices[i].pid;
          }
          res.status(200).json({
            kvp: o,
            keys: keyNames,
            values: valueNames
          });
        }
      );
    }
    if (zinvite) {
      checkZinviteCodeValidity(zid, zinvite, doneChecking);
    } else if (suzinvite) {
      checkSuzinviteCodeValidity(zid, suzinvite, doneChecking);
    } else {
      doneChecking(false);
    }
  }
  function createReport(zid) {
    return generateTokenP(20, false).then((report_id) => {
      report_id = `r${report_id}`;
      return pgQueryP('insert into reports (zid, report_id) values ($1, $2);', [zid, report_id]);
    });
  }
  function handle_POST_reports(req, res) {
    const zid = req.p.zid;
    const uid = req.p.uid;
    return isModerator(zid, uid)
      .then((isMod, err) => {
        if (!isMod) {
          return fail(res, 403, 'polis_err_post_reports_permissions', err);
        }
        return createReport(zid).then(() => {
          res.json({});
        });
      })
      .catch((err) => {
        fail(res, 500, 'polis_err_post_reports_misc', err);
      });
  }
  function handle_PUT_reports(req, res) {
    const rid = req.p.rid;
    const uid = req.p.uid;
    const zid = req.p.zid;
    return isModerator(zid, uid)
      .then((isMod, err) => {
        if (!isMod) {
          return fail(res, 403, 'polis_err_put_reports_permissions', err);
        }
        const fields = {
          modified: 'now_as_millis()'
        };
        sql_reports.columns
          .map((c) => {
            return c.name;
          })
          .filter((name) => {
            return name.startsWith('label_');
          })
          .forEach((name) => {
            if (!_.isUndefined(req.p[name])) {
              fields[name] = req.p[name];
            }
          });
        if (!_.isUndefined(req.p.report_name)) {
          fields.report_name = req.p.report_name;
        }
        const q = sql_reports.update(fields).where(sql_reports.rid.equals(rid));
        let query = q.toString();
        query = query.replace("'now_as_millis()'", 'now_as_millis()');
        return pgQueryP(query, []).then((_result) => {
          res.json({});
        });
      })
      .catch((err) => {
        fail(res, 500, 'polis_err_post_reports_misc', err);
      });
  }
  function handle_GET_reports(req, res) {
    const zid = req.p.zid;
    const rid = req.p.rid;
    const uid = req.p.uid;
    let reportsPromise = null;
    if (rid) {
      if (zid) {
        reportsPromise = Promise.reject('polis_err_get_reports_should_not_specify_both_report_id_and_conversation_id');
      } else {
        reportsPromise = pgQueryP('select * from reports where rid = ($1);', [rid]);
      }
    } else if (zid) {
      reportsPromise = isModerator(zid, uid).then((doesOwnConversation) => {
        if (!doesOwnConversation) {
          throw 'polis_err_permissions';
        }
        return pgQueryP('select * from reports where zid = ($1);', [zid]);
      });
    } else {
      reportsPromise = pgQueryP(
        'select * from reports where zid in (select zid from conversations where owner = ($1));',
        [uid]
      );
    }
    reportsPromise
      .then((reports) => {
        const zids = [];
        reports = reports.map((report) => {
          zids.push(report.zid);
          report.rid = undefined;
          return report;
        });
        if (zids.length === 0) {
          return res.json(reports);
        }
        return pgQueryP(`select * from zinvites where zid in (${zids.join(',')});`, []).then((zinvite_entries) => {
          const zidToZinvite = _.indexBy(zinvite_entries, 'zid');
          reports = reports.map((report) => {
            report.conversation_id = zidToZinvite[report.zid || '']?.zinvite;
            report.zid = undefined;
            return report;
          });
          res.json(reports);
        });
      })
      .catch((err) => {
        if (err === 'polis_err_permissions') {
          fail(res, 403, 'polis_err_permissions');
        } else if (err === 'polis_err_get_reports_should_not_specify_both_report_id_and_conversation_id') {
          fail(res, 404, 'polis_err_get_reports_should_not_specify_both_report_id_and_conversation_id');
        } else {
          fail(res, 500, 'polis_err_get_reports_misc', err);
        }
      });
  }
  function handle_GET_contexts(_req, res) {
    pgQueryP_readOnly('select name from contexts where is_public = TRUE order by name;', [])
      .then(
        (contexts) => {
          res.status(200).json(contexts);
        },
        (err) => {
          fail(res, 500, 'polis_err_get_contexts_query', err);
        }
      )
      .catch((err) => {
        fail(res, 500, 'polis_err_get_contexts_misc', err);
      });
  }
  function handle_POST_contexts(req, res) {
    const uid = req.p.uid;
    const name = req.p.name;
    function createContext() {
      return pgQueryP('insert into contexts (name, creator, is_public) values ($1, $2, $3);', [name, uid, true])
        .then(
          () => {
            res.status(200).json({});
          },
          (err) => {
            fail(res, 500, 'polis_err_post_contexts_query', err);
          }
        )
        .catch((err) => {
          fail(res, 500, 'polis_err_post_contexts_misc', err);
        });
    }
    pgQueryP('select name from contexts where name = ($1);', [name])
      .then(
        (rows) => {
          const exists = rows?.length;
          if (exists) {
            fail(res, 422, 'polis_err_post_context_exists');
            return;
          }
          return createContext();
        },
        (err) => {
          fail(res, 500, 'polis_err_post_contexts_check_query', err);
        }
      )
      .catch((err) => {
        fail(res, 500, 'polis_err_post_contexts_check_misc', err);
      });
  }
  function getLocationsForParticipants(zid) {
    return pgQueryP_readOnly('select * from participant_locations where zid = ($1);', [zid]);
  }
  function handle_GET_locations(req, res) {
    const zid = req.p.zid;
    const gid = req.p.gid;
    Promise.all([getPidsForGid(zid, gid, -1), getLocationsForParticipants(zid)])
      .then((o) => {
        const pids = o[0];
        let locations = o[1];
        locations = locations.filter((locData) => {
          const pidIsInGroup = _.indexOf(pids, locData.pid, true) >= 0;
          return pidIsInGroup;
        });
        locations = locations.map((locData) => ({
          lat: locData.lat,
          lng: locData.lng,
          n: 1
        }));
        res.status(200).json(locations);
      })
      .catch((err) => {
        fail(res, 500, 'polis_err_locations_01', err);
      });
  }
  function handle_POST_einvites(req, res) {
    const email = req.p.email;
    doSendEinvite(req, email)
      .then(() => {
        res.status(200).json({});
      })
      .catch((err) => {
        fail(res, 500, 'polis_err_sending_einvite', err);
      });
  }
  function handle_GET_einvites(req, res) {
    const einvite = req.p.einvite;
    pgQueryP('select * from einvites where einvite = ($1);', [einvite])
      .then((rows) => {
        if (!rows.length) {
          throw new Error('polis_err_missing_einvite');
        }
        res.status(200).json(rows[0]);
      })
      .catch((err) => {
        fail(res, 500, 'polis_err_fetching_einvite', err);
      });
  }
  function handle_POST_contributors(req, res) {
    const uid = req.p.uid || null;
    const agreement_version = req.p.agreement_version;
    const name = req.p.name;
    const email = req.p.email;
    const github_id = req.p.github_id;
    const company_name = req.p.company_name;
    pgQueryP(
      'insert into contributor_agreement_signatures (uid, agreement_version, github_id, name, email, company_name) ' +
        'values ($1, $2, $3, $4, $5, $6);',
      [uid, agreement_version, github_id, name, email, company_name]
    ).then(
      () => {
        emailTeam(
          'contributer agreement signed',
          [uid, agreement_version, github_id, name, email, company_name].join('\n')
        );
        res.json({});
      },
      (err) => {
        fail(res, 500, 'polis_err_POST_contributors_misc', err);
      }
    );
  }
  function handle_GET_testConnection(_req, res) {
    res.status(200).json({
      status: 'ok'
    });
  }
  function handle_GET_testDatabase(_req, res) {
    pgQueryP('select uid from users limit 1', []).then(
      (_rows) => {
        res.status(200).json({
          status: 'ok'
        });
      },
      (err) => {
        fail(res, 500, 'polis_err_testDatabase', err);
      }
    );
  }
  function makeRedirectorTo(path) {
    return (req, res) => {
      const protocol = devMode ? 'http://' : 'https://';
      const url = protocol + req?.headers?.host + path;
      res.writeHead(302, {
        Location: url
      });
      res.end();
    };
  }
  function fetchThirdPartyCookieTestPt1(_req, res) {
    res.set({ 'Content-Type': 'text/html' });
    res.send(
      Buffer.from(
        '<body>\n' +
          '<script>\n' +
          '  document.cookie="thirdparty=yes; Max-Age=3600; SameSite=None; Secure";\n' +
          '  document.location="thirdPartyCookieTestPt2.html";\n' +
          '</script>\n' +
          '</body>'
      )
    );
  }
  function fetchThirdPartyCookieTestPt2(_req, res) {
    res.set({ 'Content-Type': 'text/html' });
    res.send(
      Buffer.from(
        '<body>\n' +
          '<script>\n' +
          '  if (window.parent) {\n' +
          '   if (/thirdparty=yes/.test(document.cookie)) {\n' +
          "     window.parent.postMessage('MM:3PCsupported', '*');\n" +
          '   } else {\n' +
          "     window.parent.postMessage('MM:3PCunsupported', '*');\n" +
          '   }\n' +
          "   document.cookie = 'thirdparty=; expires=Thu, 01 Jan 1970 00:00:01 GMT;';\n" +
          '  }\n' +
          '</script>\n' +
          '</body>'
      )
    );
  }
  logger.debug('end initializePolisHelpers');
  const returnObject = {
    COOKIES,
    devMode,
    fail,
    fetchThirdPartyCookieTestPt1,
    fetchThirdPartyCookieTestPt2,
    finishArray,
    getPidForParticipant,
    haltOnTimeout,
    HMAC_SIGNATURE_PARAM_NAME,
    makeRedirectorTo,
    pidCache,
    redirectIfHasZidButNoConversationId,
    redirectIfNotHttps,
    sendTextEmail,
    timeout,
    writeDefaultHead,
    handle_DELETE_metadata_answers,
    handle_DELETE_metadata_questions,
    handle_GET_bid,
    handle_GET_bidToPid,
    handle_GET_contexts,
    handle_GET_math_correlationMatrix,
    handle_GET_dataExport,
    handle_GET_dataExport_results,
    handle_GET_reportExport,
    handle_GET_dummyButton,
    handle_GET_einvites,
    handle_GET_launchPrep,
    handle_GET_locations,
    handle_GET_math_pca,
    handle_GET_math_pca2,
    handle_GET_metadata,
    handle_GET_metadata_answers,
    handle_GET_metadata_choices,
    handle_GET_metadata_questions,
    handle_GET_perfStats,
    handle_GET_reports,
    handle_GET_reportNarrative,
    handle_GET_snapshot,
    handle_GET_testConnection,
    handle_GET_testDatabase,
    handle_GET_tryCookie,
    handle_GET_users,
    handle_GET_votes,
    handle_GET_votes_me,
    handle_GET_xids,
    handle_GET_zinvites,
    handle_POST_auth_password,
    handle_POST_auth_pwresettoken,
    handle_POST_contexts,
    handle_POST_contributors,
    handle_POST_einvites,
    handle_POST_math_update,
    handle_POST_metadata_answers,
    handle_POST_metadata_questions,
    handle_POST_metrics,
    handle_POST_reports,
    handle_POST_stars,
    handle_POST_trashes,
    handle_POST_tutorial,
    handle_POST_upvotes,
    handle_POST_votes,
    handle_POST_xidWhitelist,
    handle_POST_zinvites,
    handle_PUT_reports,
    handle_PUT_users
  };
  return returnObject;
}
export { initializePolisHelpers };
export default { initializePolisHelpers };
