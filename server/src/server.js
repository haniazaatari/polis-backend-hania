import akismetLib from 'akismet';
import async from 'async';
import AWS from 'aws-sdk';
import bcrypt from 'bcryptjs';
import { Promise as BluebirdPromise } from 'bluebird';
import timeout from 'connect-timeout';
import { encode } from 'html-entities';
import httpProxy from 'http-proxy';
import { LRUCache } from 'lru-cache';
import replaceStream from 'replacestream';
import request from 'request-promise';
import responseTime from 'response-time';
import _ from 'underscore';
import CreateUser from './auth/create-user.js';
import Password from './auth/password.js';
import Comment from './comment.js';
import Config from './config.js';
import Conversation from './conversation.js';
import {
  query as pgQuery,
  queryP as pgQueryP,
  queryP_metered_readOnly as pgQueryP_metered_readOnly,
  queryP_readOnly as pgQueryP_readOnly,
  queryP_readOnly_wRetryIfEmpty as pgQueryP_readOnly_wRetryIfEmpty,
  query_readOnly as pgQuery_readOnly
} from './db/pg-query.js';
import SQL from './db/sql.js';
import { handle_GET_dataExport, handle_GET_dataExport_results } from './routes/dataExport.js';
import { handle_GET_reportExport } from './routes/export.js';
import handle_GET_launchPrep from './routes/launchPrep.js';
import {
  getBidsForPids,
  getXids,
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
import { votesPost } from './routes/votes.js';
import Session from './session.js';
import User from './user.js';
import Utils from './utils/common.js';
import constants from './utils/constants.js';
import cookies from './utils/cookies.js';
import fail from './utils/fail.js';
import logger from './utils/logger.js';
import { METRICS_IN_RAM, MPromise, addInRamMetric } from './utils/metered.js';
import { getPidsForGid } from './utils/participants.js';
import { fetchAndCacheLatestPcaData, getPca } from './utils/pca.js';
import { getZinvite } from './utils/zinvite.js';

import { addNoMoreCommentsRecord, createModerationUrl, getNextComment } from './icebergs/comment.js';
import {
  updateConversationModifiedTime,
  updateLastInteractionTimeForConversation,
  updateVoteCount
} from './icebergs/conversation.js';
import {
  createOneSuzinvite,
  doSendEinvite,
  emailBadProblemTime,
  emailFeatureRequest,
  emailTeam,
  sendEmailByUid,
  sendImplicitConversationCreatedEmails,
  sendNotificationEmail,
  sendTextEmail
} from './icebergs/email.js';
import { addParticipant } from './icebergs/participant.js';
import { addConversationIds, finishArray, finishOne } from './icebergs/response.js';

AWS.config.update({ region: Config.awsRegion });
const devMode = Config.isDevMode;
const generateAndRegisterZinvite = CreateUser.generateAndRegisterZinvite;
const generateToken = Password.generateToken;
const generateTokenP = Password.generateTokenP;
const COOKIES = cookies.COOKIES;
const COOKIES_TO_CLEAR = cookies.COOKIES_TO_CLEAR;
const DEFAULTS = constants.DEFAULTS;

if (devMode) {
  BluebirdPromise.longStackTraces();
}
BluebirdPromise.onPossiblyUnhandledRejection((err) => {
  logger.error('onPossiblyUnhandledRejection', err);
});

const polisDevs = Config.adminUIDs ? JSON.parse(Config.adminUIDs) : [];
function isPolisDev(uid) {
  return polisDevs.indexOf(uid) >= 0;
}

const serverUrl = Config.getServerUrl();
const akismet = akismetLib.client({
  blog: serverUrl,
  apiKey: Config.akismetAntispamApiKey
});
akismet.verifyKey((_err, verified) => {
  if (verified) {
    logger.debug('Akismet: API key successfully verified.');
  } else {
    logger.debug('Akismet: Unable to verify API key.');
  }
});
function DD(f) {
  this.m = {};
  this.f = f;
}
function DA(f) {
  this.m = [];
  this.f = f;
}
DD.prototype.g = DA.prototype.g = function (k) {
  if (Object.prototype.hasOwnProperty.call(this.m, k)) {
    return this.m[k];
  }
  const v = this.f(k);
  this.m[k] = v;
  return v;
};
DD.prototype.s = DA.prototype.s = function (k, v) {
  this.m[k] = v;
};
function haltOnTimeout(req, res, next) {
  if (req.timedout) {
    fail(res, 500, 'polis_err_timeout_misc');
  } else {
    next();
  }
}
function ifDefinedSet(name, source, dest) {
  if (!_.isUndefined(source[name])) {
    dest[name] = source[name];
  }
}
const sql_votes_latest_unique = SQL.sql_votes_latest_unique;
const sql_conversations = SQL.sql_conversations;
const sql_participant_metadata_answers = SQL.sql_participant_metadata_answers;
const sql_participants_extended = SQL.sql_participants_extended;
const sql_reports = SQL.sql_reports;
const sql_users = SQL.sql_users;
const encrypt = Session.encrypt;
const getUserInfoForSessionToken = Session.getUserInfoForSessionToken;
const startSession = Session.startSession;
const endSession = Session.endSession;
const getUserInfoForUid2 = User.getUserInfoForUid2;
const HMAC_SIGNATURE_PARAM_NAME = 'signature';

function hasAuthToken(req) {
  return !!req.cookies[COOKIES.TOKEN];
}
function getUidForApiKey(apikey) {
  return pgQueryP_readOnly_wRetryIfEmpty('select uid from apikeysndvweifu WHERE apikey = ($1);', [apikey]);
}
function doApiKeyBasicAuth(assigner, header, isOptional, req, res, next) {
  const token = header.split(/\s+/).pop() || '';
  const auth = Buffer.from(token, 'base64').toString();
  const parts = auth.split(/:/);
  const username = parts[0];
  const apikey = username;
  return doApiKeyAuth(assigner, apikey, isOptional, req, res, next);
}
function doApiKeyAuth(assigner, apikey, _isOptional, req, res, next) {
  getUidForApiKey(apikey)
    .then((rows) => {
      if (!rows || !rows.length) {
        res.status(403);
        next('polis_err_auth_no_such_api_token');
        return;
      }
      assigner(req, 'uid', Number(rows[0].uid));
      next();
    })
    .catch((err) => {
      res.status(403);
      logger.error('polis_err_auth_no_such_api_token2', err);
      next('polis_err_auth_no_such_api_token2');
    });
}
const createDummyUser = User.createDummyUser;
const getConversationInfo = Conversation.getConversationInfo;
const getConversationInfoByConversationId = Conversation.getConversationInfoByConversationId;
const isXidWhitelisted = Conversation.isXidWhitelisted;
const getXidRecordByXidOwnerId = User.getXidRecordByXidOwnerId;
function doXidApiKeyAuth(assigner, apikey, xid, isOptional, req, res, next) {
  getUidForApiKey(apikey)
    .then(
      (rows) => {
        if (!rows || !rows.length) {
          res.status(403);
          next('polis_err_auth_no_such_api_token4');
          return;
        }
        const uidForApiKey = Number(rows[0].uid);
        return getXidRecordByXidOwnerId(
          xid,
          uidForApiKey,
          void 0,
          req.body.x_profile_image_url || req?.query?.x_profile_image_url,
          req.body.x_name || req?.query?.x_name || null,
          req.body.x_email || req?.query?.x_email || null,
          !!req.body.agid || !!req?.query?.agid || null
        ).then((rows) => {
          if (!rows || !rows.length) {
            if (isOptional) {
              return next();
            }
            res.status(403);
            next('polis_err_auth_no_such_xid_for_this_apikey_1');
            return;
          }
          const uidForCurrentUser = Number(rows[0].uid);
          assigner(req, 'uid', uidForCurrentUser);
          assigner(req, 'xid', xid);
          assigner(req, 'owner_uid', uidForApiKey);
          assigner(req, 'org_id', uidForApiKey);
          next();
        });
      },
      (err) => {
        res.status(403);
        logger.error('polis_err_auth_no_such_api_token3', err);
        next('polis_err_auth_no_such_api_token3');
      }
    )
    .catch((err) => {
      res.status(403);
      logger.error('polis_err_auth_misc_23423', err);
      next('polis_err_auth_misc_23423');
    });
}
function doHeaderAuth(assigner, _isOptional, req, res, next) {
  let token = '';
  if (req?.headers) token = req?.headers?.['x-polis'];
  getUserInfoForSessionToken(token, res, (err, uid) => {
    if (err) {
      res.status(403);
      next('polis_err_auth_no_such_token');
      return;
    }
    if (req.body.uid && req.body.uid !== uid) {
      res.status(401);
      next('polis_err_auth_mismatch_uid');
      return;
    }
    assigner(req, 'uid', Number(uid));
    next();
  });
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
  const polisTypes = Utils.polisTypes;
  const setParentReferrerCookie = cookies.setParentReferrerCookie;
  const setParentUrlCookie = cookies.setParentUrlCookie;
  const setCookieTestCookie = cookies.setCookieTestCookie;
  const addCookies = cookies.addCookies;
  const getPermanentCookieAndEnsureItIsSet = cookies.getPermanentCookieAndEnsureItIsSet;
  const pidCache = User.pidCache;
  const getPid = User.getPid;
  const getPidPromise = User.getPidPromise;
  const getPidForParticipant = User.getPidForParticipant;
  const isModerator = Utils.isModerator;
  function recordPermanentCookieZidJoin(permanentCookieToken, zid) {
    function doInsert() {
      return pgQueryP('insert into permanentCookieZidJoins (cookie, zid) values ($1, $2);', [
        permanentCookieToken,
        zid
      ]);
    }
    return pgQueryP('select zid from permanentCookieZidJoins where cookie = ($1) and zid = ($2);', [
      permanentCookieToken,
      zid
    ]).then(
      (rows) => {
        if (rows?.length) {
          // noop
        } else {
          return doInsert();
        }
      },
      (err) => {
        logger.error('error in recordPermanentCookieZidJoin', err);
        return doInsert();
      }
    );
  }
  const detectLanguage = Comment.detectLanguage;
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
  function doXidConversationIdAuth(assigner, xid, conversation_id, isOptional, req, res, onDone) {
    return getConversationInfoByConversationId(conversation_id)
      .then((conv) => {
        return getXidRecordByXidOwnerId(
          xid,
          conv.org_id,
          conv.zid,
          req.body.x_profile_image_url || req?.query?.x_profile_image_url,
          req.body.x_name || req?.query?.x_name || null,
          req.body.x_email || req?.query?.x_email || null,
          !!req.body.agid || !!req?.query?.agid || null
        ).then((rows) => {
          if (!rows || !rows.length) {
            if (isOptional) {
              return onDone();
            }
            res.status(403);
            onDone('polis_err_auth_no_such_xid_for_this_apikey_11');
            return;
          }
          const uidForCurrentUser = Number(rows[0].uid);
          assigner(req, 'uid', uidForCurrentUser);
          onDone();
        });
      })
      .catch((err) => {
        logger.error('doXidConversationIdAuth error', err);
        onDone(err);
      });
  }
  function _auth(assigner, isOptional) {
    function getKey(req, key) {
      return req.body[key] || req?.headers?.[key] || req?.query?.[key];
    }
    function doAuth(req, res) {
      const token = req.cookies[COOKIES.TOKEN];
      const xPolisToken = req?.headers?.['x-polis'];
      return new Promise((resolve, reject) => {
        function onDone(err) {
          if (err) {
            reject(err);
          }
          if ((!req.p || !req.p.uid) && !isOptional) {
            reject('polis_err_mandatory_auth_unsuccessful');
          }
          resolve(req.p?.uid);
        }
        if (xPolisToken) {
          logger.info('authtype: doHeaderAuth');
          doHeaderAuth(assigner, isOptional, req, res, onDone);
        } else if (getKey(req, 'polisApiKey') && getKey(req, 'ownerXid')) {
          doXidApiKeyAuth(assigner, getKey(req, 'polisApiKey'), getKey(req, 'ownerXid'), isOptional, req, res, onDone);
        } else if (getKey(req, 'polisApiKey') && getKey(req, 'xid')) {
          doXidApiKeyAuth(assigner, getKey(req, 'polisApiKey'), getKey(req, 'xid'), isOptional, req, res, onDone);
        } else if (getKey(req, 'xid') && getKey(req, 'conversation_id')) {
          doXidConversationIdAuth(
            assigner,
            getKey(req, 'xid'),
            getKey(req, 'conversation_id'),
            isOptional,
            req,
            res,
            onDone
          );
        } else if (req?.headers?.['x-sandstorm-app-polis-apikey']) {
          doApiKeyAuth(assigner, req?.headers?.['x-sandstorm-app-polis-apikey'], isOptional, req, res, onDone);
        } else if (req.body.polisApiKey) {
          doApiKeyAuth(assigner, getKey(req, 'polisApiKey'), isOptional, req, res, onDone);
        } else if (token) {
          doCookieAuth(assigner, isOptional, req, res, onDone);
        } else if (req?.headers?.authorization) {
          doApiKeyBasicAuth(assigner, req.headers.authorization, isOptional, req, res, onDone);
        } else if (req.body.agid) {
          createDummyUser()
            .then(
              (uid) => {
                const shouldAddCookies = _.isUndefined(req.body.xid);
                if (!shouldAddCookies) {
                  req.p = req.p || {};
                  req.p.uid = uid;
                  return onDone();
                }
                return startSessionAndAddCookies(req, res, uid).then(
                  () => {
                    req.p = req.p || {};
                    req.p.uid = uid;
                    onDone();
                  },
                  (err) => {
                    res.status(500);
                    logger.error('polis_err_auth_token_error_2343', err);
                    onDone('polis_err_auth_token_error_2343');
                  }
                );
              },
              (err) => {
                res.status(500);
                logger.error('polis_err_auth_token_error_1241', err);
                onDone('polis_err_auth_token_error_1241');
              }
            )
            .catch((err) => {
              res.status(500);
              logger.error('polis_err_auth_token_error_5345', err);
              onDone('polis_err_auth_token_error_5345');
            });
        } else if (isOptional) {
          onDone();
        } else {
          res.status(401);
          onDone('polis_err_auth_token_not_supplied');
        }
      });
    }
    return (req, res, next) => {
      doAuth(req, res)
        .then(() => {
          return next();
        })
        .catch((err) => {
          res.status(500);
          logger.error('polis_err_auth_error_432', err);
          next(err || 'polis_err_auth_error_432');
        });
    };
  }
  function authOptional(assigner) {
    return _auth(assigner, true);
  }
  function auth(assigner) {
    return _auth(assigner, false);
  }
  function enableAgid(req, _res, next) {
    req.body.agid = 1;
    next();
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
  function clearCookie(req, res, cookieName) {
    res?.clearCookie?.(cookieName, {
      path: '/',
      domain: cookies.cookieDomain(req)
    });
  }
  function clearCookies(req, res) {
    let cookieName;
    for (cookieName in req.cookies) {
      if (COOKIES_TO_CLEAR[cookieName]) {
        res?.clearCookie?.(cookieName, {
          path: '/',
          domain: cookies.cookieDomain(req)
        });
      }
    }
    logger.info(`after clear res set-cookie: ${JSON.stringify(res?._headers?.['set-cookie'])}`);
  }
  function doCookieAuth(assigner, isOptional, req, res, next) {
    const token = req.cookies[COOKIES.TOKEN];
    getUserInfoForSessionToken(token, res, (err, uid) => {
      if (err) {
        clearCookies(req, res);
        if (isOptional) {
          next();
        } else {
          res.status(403);
          next('polis_err_auth_no_such_token');
        }
        return;
      }
      if (req.body.uid && req.body.uid !== uid) {
        res.status(401);
        next('polis_err_auth_mismatch_uid');
        return;
      }
      assigner(req, 'uid', Number(uid));
      next();
    });
  }
  function handle_POST_auth_deregister(req, res) {
    req.p = req.p || {};
    const token = req.cookies[COOKIES.TOKEN];
    clearCookies(req, res);
    function finish() {
      if (!req.p.showPage) {
        res.status(200).end();
      }
    }
    if (!token) {
      return finish();
    }
    endSession(token, (err, _data) => {
      if (err) {
        fail(res, 500, "couldn't end session", err);
        return;
      }
      finish();
    });
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
  function getSUZinviteInfo(suzinvite) {
    return new Promise((resolve, reject) => {
      pgQuery('SELECT * FROM suzinvites WHERE suzinvite = ($1);', [suzinvite], (err, results) => {
        if (err) {
          return reject(err);
        }
        if (!results || !results.rows || !results.rows.length) {
          return reject(new Error('polis_err_no_matching_suzinvite'));
        }
        resolve(results.rows[0]);
      });
    });
  }
  const deleteSuzinvite = async (suzinvite) => {
    try {
      await pgQuery('DELETE FROM suzinvites WHERE suzinvite = ($1);', [suzinvite]);
    } catch (err) {
      logger.error('polis_err_removing_suzinvite', err);
    }
  };
  function xidExists(xid, owner, uid) {
    return pgQueryP('select * from xids where xid = ($1) and owner = ($2) and uid = ($3);', [xid, owner, uid]).then(
      (rows) => rows?.length
    );
  }
  const createXidEntry = async (xid, owner, uid) => {
    try {
      await pgQueryP('INSERT INTO xids (uid, owner, xid) VALUES ($1, $2, $3);', [uid, owner, xid]);
    } catch (err) {
      logger.error('polis_err_adding_xid_entry', err);
      throw new Error('polis_err_adding_xid_entry');
    }
  };
  function saveParticipantMetadataChoicesP(zid, pid, answers) {
    return new Promise((resolve, reject) => {
      saveParticipantMetadataChoices(zid, pid, answers, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve(0);
        }
      });
    });
  }
  function saveParticipantMetadataChoices(zid, pid, answers, callback) {
    if (!answers || !answers.length) {
      return callback(0);
    }
    const q = `select * from participant_metadata_answers where zid = ($1) and pmaid in (${answers.join(',')});`;
    pgQuery(q, [zid], (err, qa_results) => {
      if (err) {
        logger.error('polis_err_getting_participant_metadata_answers', err);
        return callback(err);
      }
      qa_results = qa_results.rows;
      qa_results = _.indexBy(qa_results, 'pmaid');
      answers = answers.map((pmaid) => {
        const pmqid = qa_results[pmaid].pmqid;
        return [zid, pid, pmaid, pmqid];
      });
      async.map(
        answers,
        (x, cb) => {
          pgQuery(
            'INSERT INTO participant_metadata_choices (zid, pid, pmaid, pmqid) VALUES ($1,$2,$3,$4);',
            x,
            (err, _results) => {
              if (err) {
                logger.error('polis_err_saving_participant_metadata_choices', err);
                return cb(err);
              }
              cb(0);
            }
          );
        },
        (err) => {
          if (err) {
            logger.error('polis_err_saving_participant_metadata_choices', err);
            return callback(err);
          }
          callback(0);
        }
      );
    });
  }
  function createParticpantLocationRecord(zid, uid, pid, lat, lng, source) {
    return pgQueryP('insert into participant_locations (zid, uid, pid, lat, lng, source) values ($1,$2,$3,$4,$5,$6);', [
      zid,
      uid,
      pid,
      lat,
      lng,
      source
    ]);
  }
  function getUsersLocationName(_uid) {
    return Promise.resolve(null);
  }
  function populateParticipantLocationRecordIfPossible(zid, uid, pid) {
    getUsersLocationName(uid)
      .then((locationData) => {
        if (!locationData || !Config.googleApiKey) {
          return;
        }
        geoCode(locationData.location)
          .then((o) => {
            createParticpantLocationRecord(zid, uid, pid, o.lat, o.lng, locationData.source).catch((err) => {
              if (!isDuplicateKey(err)) {
                logger.error('polis_err_creating_particpant_location_record', err);
              }
            });
          })
          .catch((err) => {
            logger.error('polis_err_geocoding', err);
          });
      })
      .catch((err) => {
        logger.error('polis_err_fetching_user_location_name', err);
      });
  }
  function addExtendedParticipantInfo(zid, uid, data) {
    if (!data || !_.keys(data).length) {
      return Promise.resolve();
    }
    const params = Object.assign({}, data, {
      zid: zid,
      uid: uid,
      modified: 9876543212345
    });
    const qUpdate = sql_participants_extended
      .update(params)
      .where(sql_participants_extended.zid.equals(zid))
      .and(sql_participants_extended.uid.equals(uid));
    let qString = qUpdate.toString();
    qString = qString.replace('9876543212345', 'now_as_millis()');
    return pgQueryP(qString, []);
  }
  function tryToJoinConversation(zid, uid, info, pmaid_answers) {
    function doAddExtendedParticipantInfo() {
      if (info && _.keys(info).length > 0) {
        addExtendedParticipantInfo(zid, uid, info);
      }
    }
    function saveMetadataChoices(pid) {
      if (pmaid_answers?.length) {
        saveParticipantMetadataChoicesP(zid, pid, pmaid_answers);
      }
    }
    return addParticipant(zid, uid).then((rows) => {
      const pid = rows?.[0]?.pid;
      const ptpt = rows[0];
      doAddExtendedParticipantInfo();
      if (pmaid_answers?.length) {
        saveMetadataChoices();
      }
      populateParticipantLocationRecordIfPossible(zid, uid, pid);
      return ptpt;
    });
  }
  function addParticipantAndMetadata(zid, uid, req, permanent_cookie) {
    const info = {};
    const parent_url = req?.cookies?.[COOKIES.PARENT_URL] || req?.p?.parent_url;
    const referer = req?.cookies[COOKIES.PARENT_REFERRER] || req?.headers?.referer || req?.headers?.referrer;
    if (parent_url) {
      info.parent_url = parent_url;
    }
    if (referer) {
      info.referrer = referer;
    }
    if (Config.applicationName === 'PolisWebServer') {
      const x_forwarded_for = req?.headers?.['x-forwarded-for'];
      let ip = null;
      if (x_forwarded_for) {
        let ips = x_forwarded_for;
        ips = ips?.split(', ');
        ip = ips.length && ips[0];
        info.encrypted_ip_address = encrypt(ip);
        info.encrypted_x_forwarded_for = encrypt(x_forwarded_for);
      }
    }
    if (permanent_cookie) {
      info.permanent_cookie = permanent_cookie;
    }
    if (req?.headers?.origin) {
      info.origin = req?.headers?.origin;
    }
    return addParticipant(zid, uid).then((rows) => {
      const ptpt = rows[0];
      const pid = ptpt.pid;
      populateParticipantLocationRecordIfPossible(zid, uid, pid);
      addExtendedParticipantInfo(zid, uid, info);
      return rows;
    });
  }
  function joinConversation(zid, uid, info, pmaid_answers) {
    function tryJoin() {
      return tryToJoinConversation(zid, uid, info, pmaid_answers);
    }
    function doJoin() {
      const promise = tryJoin()
        .catch(tryJoin)
        .catch(tryJoin)
        .catch(tryJoin)
        .catch(tryJoin)
        .catch(tryJoin)
        .catch(tryJoin)
        .catch(tryJoin)
        .catch(tryJoin)
        .catch(tryJoin);
      return promise;
    }
    return getPidPromise(zid, uid).then((pid) => {
      if (pid >= 0) {
        return;
      }
      return doJoin();
    }, doJoin);
  }
  function isOwnerOrParticipant(zid, uid, callback) {
    getPid(zid, uid, (err, pid) => {
      if (err || pid < 0) {
        isConversationOwner(zid, uid, (err) => {
          callback?.(err);
        });
      } else {
        callback?.(null);
      }
    });
  }
  function isConversationOwner(zid, uid, callback) {
    pgQuery_readOnly('SELECT * FROM conversations WHERE zid = ($1) AND owner = ($2);', [zid, uid], (err, docs) => {
      if (!docs || !docs.rows || docs.rows.length === 0) {
        err = err || 1;
      }
      callback?.(err);
    });
  }
  function isOwner(zid, uid) {
    return getConversationInfo(zid).then((info) => info.owner === uid);
  }
  function getParticipant(zid, uid) {
    return new MPromise('getParticipant', (resolve, reject) => {
      pgQuery_readOnly('SELECT * FROM participants WHERE zid = ($1) AND uid = ($2);', [zid, uid], (err, results) => {
        if (err) {
          return reject(err);
        }
        if (!results || !results.rows) {
          return reject(new Error('polis_err_getParticipant_failed'));
        }
        resolve(results.rows[0]);
      });
    });
  }
  function getAnswersForConversation(zid, callback) {
    pgQuery_readOnly('SELECT * from participant_metadata_answers WHERE zid = ($1) AND alive=TRUE;', [zid], (err, x) => {
      if (err) {
        callback(err);
        return;
      }
      callback(0, x.rows);
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
  function handle_GET_participants(req, res) {
    const uid = req.p.uid;
    const zid = req.p.zid;
    pgQueryP_readOnly('select * from participants where uid = ($1) and zid = ($2)', [uid, zid])
      .then((rows) => {
        const ptpt = (rows?.length && rows[0]) || null;
        res.status(200).json(ptpt);
      })
      .catch((err) => {
        fail(res, 500, 'polis_err_get_participant', err);
      });
  }
  function handle_GET_dummyButton(req, res) {
    const message = `${req.p.button} ${req.p.uid}`;
    emailFeatureRequest(message);
    res.status(200).end();
  }
  function doGetConversationsRecent(req, res, field) {
    if (!isPolisDev(req.p.uid)) {
      fail(res, 403, 'polis_err_no_access_for_this_user');
      return;
    }
    let time = req.p.sinceUnixTimestamp;
    if (_.isUndefined(time)) {
      time = Date.now() - 1000 * 60 * 60 * 24 * 7;
    } else {
      time *= 1000;
    }
    time = Number.parseInt(time);
    pgQueryP_readOnly(`select * from conversations where ${field} >= ($1);`, [time])
      .then((rows) => {
        res.json(rows);
      })
      .catch((err) => {
        fail(res, 403, 'polis_err_conversationsRecent', err);
      });
  }
  function handle_GET_conversationsRecentlyStarted(req, res) {
    doGetConversationsRecent(req, res, 'created');
  }
  function handle_GET_conversationsRecentActivity(req, res) {
    doGetConversationsRecent(req, res, 'modified');
  }
  function userHasAnsweredZeQuestions(zid, answers) {
    return new MPromise('userHasAnsweredZeQuestions', (resolve, reject) => {
      getAnswersForConversation(zid, (err, available_answers) => {
        if (err) {
          reject(err);
          return;
        }
        const q2a = _.indexBy(available_answers, 'pmqid');
        const a2q = _.indexBy(available_answers, 'pmaid');
        for (let i = 0; i < answers.length; i++) {
          const pmqid = a2q[answers[i]].pmqid;
          delete q2a[pmqid];
        }
        const remainingKeys = _.keys(q2a);
        const missing = remainingKeys && remainingKeys.length > 0;
        if (missing) {
          return reject(new Error(`polis_err_metadata_not_chosen_pmqid_${remainingKeys[0]}`));
        }
        return resolve();
      });
    });
  }
  function handle_POST_participants(req, res) {
    const zid = req.p.zid;
    const uid = req.p.uid;
    const answers = req.p.answers;
    const info = {};
    const parent_url = req.cookies[COOKIES.PARENT_URL] || req.p.parent_url;
    const referrer = req.cookies[COOKIES.PARENT_REFERRER] || req.p.referrer;
    if (parent_url) {
      info.parent_url = parent_url;
    }
    if (referrer) {
      info.referrer = referrer;
    }
    function finish(ptpt) {
      clearCookie(req, res, COOKIES.PARENT_URL);
      clearCookie(req, res, COOKIES.PARENT_REFERRER);
      setTimeout(() => {
        updateLastInteractionTimeForConversation(zid, uid);
      }, 0);
      res.status(200).json(ptpt);
    }
    function doJoin() {
      userHasAnsweredZeQuestions(zid, answers).then(
        () => {
          joinConversation(zid, uid, info, answers).then(
            (ptpt) => {
              finish(ptpt);
            },
            (err) => {
              fail(res, 500, 'polis_err_add_participant', err);
            }
          );
        },
        (err) => {
          fail(res, 400, err.message, err);
        }
      );
    }
    getParticipant(zid, req.p.uid)
      .then(
        (ptpt) => {
          if (ptpt) {
            finish(ptpt);
            populateParticipantLocationRecordIfPossible(zid, req.p.uid, ptpt.pid);
            addExtendedParticipantInfo(zid, req.p.uid, info);
            return;
          }
          getConversationInfo(zid)
            .then(() => {
              doJoin();
            })
            .catch((err) => {
              fail(res, 500, 'polis_err_post_participants_need_uid_to_check_lti_users_4', err);
            });
        },
        (err) => {
          fail(res, 500, 'polis_err_post_participants_db_err', err);
        }
      )
      .catch((err) => {
        fail(res, 500, 'polis_err_post_participants_misc', err);
      });
  }
  function subscribeToNotifications(zid, uid, email) {
    const type = 1;
    logger.info('subscribeToNotifications', { zid, uid });
    return pgQueryP('update participants_extended set subscribe_email = ($3) where zid = ($1) and uid = ($2);', [
      zid,
      uid,
      email
    ]).then(() =>
      pgQueryP('update participants set subscribed = ($3) where zid = ($1) and uid = ($2);', [zid, uid, type]).then(
        (_rows) => type
      )
    );
  }
  function unsubscribeFromNotifications(zid, uid) {
    const type = 0;
    return pgQueryP('update participants set subscribed = ($3) where zid = ($1) and uid = ($2);', [
      zid,
      uid,
      type
    ]).then((_rows) => type);
  }
  function maybeAddNotificationTask(zid, timeInMillis) {
    return pgQueryP('insert into notification_tasks (zid, modified) values ($1, $2) on conflict (zid) do nothing;', [
      zid,
      timeInMillis
    ]);
  }
  function claimNextNotificationTask() {
    return pgQueryP(
      'delete from notification_tasks where zid = (select zid from notification_tasks order by random() for update skip locked limit 1) returning *;'
    ).then((rows) => {
      if (!rows || !rows.length) {
        return null;
      }
      return rows[0];
    });
  }
  function getDbTime() {
    return pgQueryP('select now_as_millis();', []).then((rows) => {
      return rows[0].now_as_millis;
    });
  }
  function doNotificationsForZid(zid, timeOfLastEvent) {
    let shouldTryAgain = false;
    return pgQueryP('select * from participants where zid = ($1) and last_notified < ($2) and subscribed > 0;', [
      zid,
      timeOfLastEvent
    ])
      .then((candidates) => {
        if (!candidates || !candidates.length) {
          return null;
        }
        candidates = candidates.map((ptpt) => {
          ptpt.last_notified = Number(ptpt.last_notified);
          ptpt.last_interaction = Number(ptpt.last_interaction);
          return ptpt;
        });
        return Promise.all([getDbTime(), getConversationInfo(zid), getZinvite(zid)]).then((a) => {
          const dbTimeMillis = a[0];
          const conv = a[1];
          const conversation_id = a[2];
          const url = conv.parent_url || `https://pol.is/${conversation_id}`;
          const pid_to_ptpt = {};
          candidates.forEach((c) => {
            pid_to_ptpt[c.pid] = c;
          });
          return BluebirdPromise.mapSeries(candidates, (item, _index, _length) => {
            return getNumberOfCommentsRemaining(item.zid, item.pid).then((rows) => {
              return rows[0];
            });
          }).then((results) => {
            const needNotification = results.filter((result) => {
              const ptpt = pid_to_ptpt[result.pid];
              let needs = true;
              needs = needs && result.remaining > 0;
              let waitTime = 60 * 60 * 1000;
              if (ptpt.nsli === 0) {
                waitTime = 60 * 60 * 1000;
              } else if (ptpt.nsli === 1) {
                waitTime = 2 * 60 * 60 * 1000;
              } else if (ptpt.nsli === 2) {
                waitTime = 24 * 60 * 60 * 1000;
              } else if (ptpt.nsli === 3) {
                waitTime = 48 * 60 * 60 * 1000;
              } else {
                needs = false;
              }
              if (needs && dbTimeMillis < ptpt.last_notified + waitTime) {
                shouldTryAgain = true;
                needs = false;
              }
              if (needs && dbTimeMillis < ptpt.last_interaction + 5 * 60 * 1000) {
                shouldTryAgain = true;
                needs = false;
              }
              if (devMode) {
                needs = needs && isPolisDev(ptpt.uid);
              }
              return needs;
            });
            if (needNotification.length === 0) {
              return null;
            }
            const pids = _.pluck(needNotification, 'pid');
            return pgQueryP(
              `select uid, subscribe_email from participants_extended where uid in (select uid from participants where pid in (${pids.join(',')}));`,
              []
            ).then((rows) => {
              const uidToEmail = {};
              rows.forEach((row) => {
                uidToEmail[row.uid] = row.subscribe_email;
              });
              return BluebirdPromise.each(needNotification, (item, _index, _length) => {
                const uid = pid_to_ptpt[item.pid].uid;
                return sendNotificationEmail(uid, url, conversation_id, uidToEmail[uid], item.remaining).then(() => {
                  return pgQueryP(
                    'update participants set last_notified = now_as_millis(), nsli = nsli + 1 where uid = ($1) and zid = ($2);',
                    [uid, zid]
                  );
                });
              });
            });
          });
        });
      })
      .then(() => {
        return shouldTryAgain;
      });
  }
  function doNotificationBatch() {
    return claimNextNotificationTask().then((task) => {
      if (!task) {
        return Promise.resolve();
      }
      return doNotificationsForZid(task.zid, task.modified).then((shouldTryAgain) => {
        if (shouldTryAgain) {
          maybeAddNotificationTask(task.zid, task.modified);
        }
      });
    });
  }
  function doNotificationLoop() {
    logger.debug('doNotificationLoop');
    doNotificationBatch().then(() => {
      setTimeout(doNotificationLoop, 10000);
    });
  }
  const shouldSendNotifications = !devMode;
  if (shouldSendNotifications) {
    doNotificationLoop();
  }
  function handle_POST_convSubscriptions(req, res) {
    const zid = req.p.zid;
    const uid = req.p.uid;
    const type = req.p.type;
    const email = req.p.email;
    function finish(type) {
      res.status(200).json({
        subscribed: type
      });
    }
    if (type === 1) {
      subscribeToNotifications(zid, uid, email)
        .then(finish)
        .catch((err) => {
          fail(res, 500, `polis_err_sub_conv ${zid} ${uid}`, err);
        });
    } else if (type === 0) {
      unsubscribeFromNotifications(zid, uid)
        .then(finish)
        .catch((err) => {
          fail(res, 500, `polis_err_unsub_conv ${zid} ${uid}`, err);
        });
    } else {
      fail(res, 400, 'polis_err_bad_subscription_type', new Error('polis_err_bad_subscription_type'));
    }
  }
  function handle_POST_auth_login(req, res) {
    const password = req.p.password;
    let email = req.p.email || '';
    email = email.toLowerCase();
    if (!_.isString(password) || !password.length) {
      fail(res, 403, 'polis_err_login_need_password');
      return;
    }
    pgQuery('SELECT * FROM users WHERE LOWER(email) = ($1);', [email], (err, docs) => {
      const { rows } = docs;
      if (err) {
        fail(res, 403, 'polis_err_login_unknown_user_or_password', err);
        return;
      }
      if (!rows || rows.length === 0) {
        fail(res, 403, 'polis_err_login_unknown_user_or_password_noresults');
        return;
      }
      const uid = rows[0].uid;
      pgQuery('select pwhash from jianiuevyew where uid = ($1);', [uid], (err, results) => {
        const { rows } = results;
        if (err) {
          fail(res, 403, 'polis_err_login_unknown_user_or_password', err);
          return;
        }
        if (!results || rows.length === 0) {
          fail(res, 403, 'polis_err_login_unknown_user_or_password');
          return;
        }
        const hashedPassword = rows[0].pwhash;
        bcrypt.compare(password, hashedPassword, (errCompare, result) => {
          logger.debug('errCompare, result', { errCompare, result });
          if (errCompare || !result) {
            fail(res, 403, 'polis_err_login_unknown_user_or_password');
            return;
          }
          startSession(uid, (_errSess, token) => {
            const response_data = {
              uid: uid,
              email: email,
              token: token
            };
            addCookies(req, res, token, uid)
              .then(() => {
                res.json(response_data);
              })
              .catch((err) => {
                fail(res, 500, 'polis_err_adding_cookies', err);
              });
          });
        });
      });
    });
  }
  function handle_POST_joinWithInvite(req, res) {
    return joinWithZidOrSuzinvite({
      answers: req.p.answers,
      existingAuth: !!req.p.uid,
      suzinvite: req.p.suzinvite,
      permanentCookieToken: req.p.permanentCookieToken,
      uid: req.p.uid,
      zid: req.p.zid,
      referrer: req.p.referrer,
      parent_url: req.p.parent_url
    })
      .then((o) => {
        const uid = o.uid;
        logger.info(`startSessionAndAddCookies ${uid} existing ${o.existingAuth}`);
        if (!o.existingAuth) {
          return startSessionAndAddCookies(req, res, uid).then(() => o);
        }
        return Promise.resolve(o);
      })
      .then((o) => {
        logger.info('permanentCookieToken', o.permanentCookieToken);
        if (o.permanentCookieToken) {
          return recordPermanentCookieZidJoin(o.permanentCookieToken, o.zid).then(
            () => o,
            () => o
          );
        }
        return o;
      })
      .then((o) => {
        const pid = o.pid;
        res.status(200).json({
          pid: pid,
          uid: req.p.uid
        });
      })
      .catch((err) => {
        if (err?.message?.match(/polis_err_need_full_user/)) {
          fail(res, 403, err.message, err);
        } else if (err?.message) {
          fail(res, 500, err.message, err);
        } else if (err) {
          fail(res, 500, 'polis_err_joinWithZidOrSuzinvite', err);
        } else {
          fail(res, 500, 'polis_err_joinWithZidOrSuzinvite');
        }
      });
  }
  function joinWithZidOrSuzinvite(o) {
    return Promise.resolve(o)
      .then((o) => {
        if (o.suzinvite) {
          return getSUZinviteInfo(o.suzinvite).then((suzinviteInfo) => Object.assign(o, suzinviteInfo));
        }
        if (o.zid) {
          return o;
        }
        throw new Error('polis_err_missing_invite');
      })
      .then((o) => {
        logger.info('joinWithZidOrSuzinvite convinfo begin');
        return getConversationInfo(o.zid).then((conv) => {
          logger.info('joinWithZidOrSuzinvite convinfo done');
          o.conv = conv;
          return o;
        });
      })
      .then((o) => o)
      .then((o) => {
        logger.info('joinWithZidOrSuzinvite userinfo begin');
        if (!o.uid) {
          logger.info('joinWithZidOrSuzinvite userinfo no uid');
          return o;
        }
        return getUserInfoForUid2(o.uid).then((user) => {
          logger.info('joinWithZidOrSuzinvite userinfo done');
          o.user = user;
          return o;
        });
      })
      .then((o) => {
        if (o.uid) {
          return o;
        }
        return createDummyUser().then((uid) =>
          Object.assign(o, {
            uid: uid
          })
        );
      })
      .then((o) => userHasAnsweredZeQuestions(o.zid, o.answers).then(() => o))
      .then((o) => {
        const info = {};
        if (o.referrer) {
          info.referrer = o.referrer;
        }
        if (o.parent_url) {
          info.parent_url = o.parent_url;
        }
        return joinConversation(o.zid, o.uid, info, o.answers).then((ptpt) => Object.assign(o, ptpt));
      })
      .then((o) => {
        if (o.xid) {
          return xidExists(o.xid, o.conv.org_id, o.uid).then((exists) => {
            if (exists) {
              return o;
            }
            const shouldCreateXidEntryPromise = o.conv.use_xid_whitelist
              ? isXidWhitelisted(o.conv.owner, o.xid)
              : Promise.resolve(true);
            shouldCreateXidEntryPromise.then((should) => {
              if (should) {
                return createXidEntry(o.xid, o.conv.org_id, o.uid).then(() => o);
              }
              throw new Error('polis_err_xid_not_whitelisted');
            });
          });
        }
        return o;
      })
      .then((o) => {
        if (o.suzinvite) {
          return deleteSuzinvite(o.suzinvite).then(() => o);
        }
        return o;
      });
  }
  function startSessionAndAddCookies(req, res, uid) {
    return new Promise((resolve, reject) => {
      startSession(uid, (err, token) => {
        if (err) {
          reject(new Error('polis_err_reg_failed_to_start_session'));
          return;
        }
        resolve(addCookies(req, res, token, uid));
      });
    });
  }
  function handle_GET_perfStats(_req, res) {
    res.json(METRICS_IN_RAM);
  }
  function getFirstForPid(votes) {
    const seen = {};
    const len = votes.length;
    const firstVotes = [];
    for (let i = 0; i < len; i++) {
      const vote = votes[i];
      if (!seen[vote.pid]) {
        firstVotes.push(vote);
        seen[vote.pid] = true;
      }
    }
    return firstVotes;
  }
  function handle_GET_conversationStats(req, res) {
    const zid = req.p.zid;
    const uid = req.p.uid;
    const until = req.p.until;
    const hasPermission = req.p.rid ? Promise.resolve(!!req.p.rid) : isModerator(zid, uid);
    hasPermission
      .then((ok) => {
        if (!ok) {
          fail(res, 403, 'polis_err_conversationStats_need_report_id_or_moderation_permission');
          return;
        }
        const args = [zid];
        const q0 = until
          ? 'select created, pid, mod from comments where zid = ($1) and created < ($2) order by created;'
          : 'select created, pid, mod from comments where zid = ($1) order by created;';
        const q1 = until
          ? 'select created, pid from votes where zid = ($1) and created < ($2) order by created;'
          : 'select created, pid from votes where zid = ($1) order by created;';
        if (until) {
          args.push(until);
        }
        return Promise.all([pgQueryP_readOnly(q0, args), pgQueryP_readOnly(q1, args)]).then((a) => {
          function castTimestamp(o) {
            o.created = Number(o.created);
            return o;
          }
          const comments = _.map(a[0], castTimestamp);
          const votes = _.map(a[1], castTimestamp);
          const votesGroupedByPid = _.groupBy(votes, 'pid');
          const votesHistogramObj = {};
          _.each(votesGroupedByPid, (votesByParticipant, _pid) => {
            votesHistogramObj[votesByParticipant.length] = votesHistogramObj[votesByParticipant.length] + 1 || 1;
          });
          let votesHistogram = [];
          _.each(votesHistogramObj, (ptptCount, voteCount) => {
            votesHistogram.push({
              n_votes: voteCount,
              n_ptpts: ptptCount
            });
          });
          votesHistogram.sort((a, b) => a.n_ptpts - b.n_ptpts);
          const burstsForPid = {};
          const interBurstGap = 10 * 60 * 1000;
          _.each(votesGroupedByPid, (votesByParticipant, pid) => {
            burstsForPid[pid] = 1;
            let prevCreated = votesByParticipant.length ? votesByParticipant[0] : 0;
            for (let v = 1; v < votesByParticipant.length; v++) {
              const vote = votesByParticipant[v];
              if (interBurstGap + prevCreated < vote.created) {
                burstsForPid[pid] += 1;
              }
              prevCreated = vote.created;
            }
          });
          const burstHistogramObj = {};
          _.each(burstsForPid, (bursts, _pid) => {
            burstHistogramObj[bursts] = burstHistogramObj[bursts] + 1 || 1;
          });
          const burstHistogram = [];
          _.each(burstHistogramObj, (ptptCount, burstCount) => {
            burstHistogram.push({
              n_ptpts: ptptCount,
              n_bursts: Number(burstCount)
            });
          });
          burstHistogram.sort((a, b) => a.n_bursts - b.n_bursts);
          let actualParticipants = getFirstForPid(votes);
          actualParticipants = _.pluck(actualParticipants, 'created');
          let commenters = getFirstForPid(comments);
          commenters = _.pluck(commenters, 'created');
          const totalComments = _.pluck(comments, 'created');
          const totalVotes = _.pluck(votes, 'created');
          votesHistogram = _.map(votesHistogram, (x) => ({
            n_votes: Number(x.n_votes),
            n_ptpts: Number(x.n_ptpts)
          }));
          res.status(200).json({
            voteTimes: totalVotes,
            firstVoteTimes: actualParticipants,
            commentTimes: totalComments,
            firstCommentTimes: commenters,
            votesHistogram: votesHistogram,
            burstHistogram: burstHistogram
          });
        });
      })
      .catch((err) => {
        fail(res, 500, 'polis_err_conversationStats_misc', err);
      });
  }
  function handle_GET_snapshot(req, _res) {
    const _uid = req.p.uid;
    const _zid = req.p.zid;

    throw new Error('TODO Needs to clone participants_extended and any other new tables as well.');
  }
  function handle_POST_auth_new(req, res) {
    CreateUser.createUser(req, res);
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
  const getUser = User.getUser;
  const getNumberOfCommentsRemaining = Comment.getNumberOfCommentsRemaining;
  function handle_GET_participation(req, res) {
    const zid = req.p.zid;
    const uid = req.p.uid;
    const strict = req.p.strict;
    isOwner(zid, uid)
      .then((ok) => {
        if (!ok) {
          fail(res, 403, 'polis_err_get_participation_auth');
          return;
        }
        return Promise.all([
          pgQueryP_readOnly('select pid, count(*) from votes where zid = ($1) group by pid;', [zid]),
          pgQueryP_readOnly('select pid, count(*) from comments where zid = ($1) group by pid;', [zid]),
          getXids(zid)
        ]).then((o) => {
          const voteCountRows = o[0];
          const commentCountRows = o[1];
          const pidXidRows = o[2];
          let i;
          let r;
          if (strict && !pidXidRows.length) {
            fail(
              res,
              409,
              'polis_err_get_participation_missing_xids This conversation has no xids for its participants.'
            );
            return;
          }
          let result = new DD(() => ({
            votes: 0,
            comments: 0
          }));
          for (i = 0; i < voteCountRows.length; i++) {
            r = voteCountRows[i];
            result.g(r.pid).votes = Number(r.count);
          }
          for (i = 0; i < commentCountRows.length; i++) {
            r = commentCountRows[i];
            result.g(r.pid).comments = Number(r.count);
          }
          result = result.m;
          if (pidXidRows?.length) {
            const pidToXid = {};
            for (i = 0; i < pidXidRows.length; i++) {
              pidToXid[pidXidRows[i].pid] = pidXidRows[i].xid;
            }
            const xidBasedResult = {};
            let size = 0;
            _.each(result, (val, key) => {
              xidBasedResult[pidToXid[key]] = val;
              size += 1;
            });
            if (strict && (commentCountRows.length || voteCountRows.length) && size > 0) {
              fail(
                res,
                409,
                'polis_err_get_participation_missing_xids This conversation is missing xids for some of its participants.'
              );
              return;
            }
            res.status(200).json(xidBasedResult);
          } else {
            res.status(200).json(result);
          }
        });
      })
      .catch((err) => {
        fail(res, 500, 'polis_err_get_participation_misc', err);
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
  function failWithRetryRequest(res) {
    res.setHeader('Retry-After', 0);
    logger.warn('failWithRetryRequest');
    res.writeHead(500).send(57493875);
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
  function handle_GET_participationInit(req, res) {
    logger.info('handle_GET_participationInit');
    function ifConv(f, args) {
      if (req.p.conversation_id) {
        return f.apply(null, args);
      }
      return Promise.resolve(null);
    }
    function ifConvAndAuth(f, args) {
      if (req.p.uid) {
        return ifConv(f, args);
      }
      return Promise.resolve(null);
    }
    const acceptLanguage = req?.headers?.['accept-language'] || req?.headers?.['Accept-Language'] || 'en-US';
    if (req.p.lang === 'acceptLang') {
      req.p.lang = acceptLanguage.substr(0, 2);
    }
    getPermanentCookieAndEnsureItIsSet(req, res);
    Promise.all([
      getUser(req.p.uid, req.p.zid, req.p.xid, req.p.owner_uid),
      ifConvAndAuth(getParticipant, [req.p.zid, req.p.uid]),
      ifConv(getNextComment, [req.p.zid, req.p.pid, [], true, req.p.lang]),
      ifConv(getOneConversation, [req.p.zid, req.p.uid, req.p.lang]),
      ifConv(getVotesForSingleParticipant, [req.p]),
      ifConv(getPca, [req.p.zid, -1]),
      ifConv(doFamousQuery, [req.p, req])
    ])
      .then(
        (arr) => {
          const conv = arr[3];
          const o = {
            user: arr[0],
            ptpt: arr[1],
            nextComment: arr[2],
            conversation: conv,
            votes: arr[4] || [],
            pca: arr[5] ? (arr[5].asJSON ? arr[5].asJSON : null) : null,
            famous: arr[6],
            acceptLanguage: acceptLanguage
          };
          if (o.conversation) {
            o.conversation.zid = undefined;
            o.conversation.conversation_id = req.p.conversation_id;
          }
          if (o.ptpt) {
            o.ptpt.zid = undefined;
          }
          for (let i = 0; i < o.votes.length; i++) {
            o.votes[i].zid = undefined;
          }
          if (!o.nextComment) {
            o.nextComment = {};
          }
          if (!_.isUndefined(req.p.pid)) {
            o.nextComment.currentPid = req.p.pid;
          }
          res.status(200).json(o);
        },
        (err) => {
          fail(res, 500, 'polis_err_get_participationInit2', err);
        }
      )
      .catch((err) => {
        fail(res, 500, 'polis_err_get_participationInit', err);
      });
  }
  function handle_PUT_participants_extended(req, res) {
    const zid = req.p.zid;
    const uid = req.p.uid;
    const fields = {};
    if (!_.isUndefined(req.p.show_translation_activated)) {
      fields.show_translation_activated = req.p.show_translation_activated;
    }
    const q = sql_participants_extended
      .update(fields)
      .where(sql_participants_extended.zid.equals(zid))
      .and(sql_participants_extended.uid.equals(uid));
    pgQueryP(q.toString(), [])
      .then((result) => {
        res.json(result);
      })
      .catch((err) => {
        fail(res, 500, 'polis_err_put_participants_extended', err);
      });
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
  function verifyMetadataAnswersExistForEachQuestion(zid) {
    const errorcode = 'polis_err_missing_metadata_answers';
    return new Promise((resolve, reject) => {
      pgQuery_readOnly('select pmqid from participant_metadata_questions where zid = ($1);', [zid], (err, results) => {
        if (err) {
          reject(err);
          return;
        }
        if (!results.rows || !results.rows.length) {
          resolve();
          return;
        }
        const pmqids = results.rows.map((row) => Number(row.pmqid));
        pgQuery_readOnly(
          `select pmaid, pmqid from participant_metadata_answers where pmqid in (${pmqids.join(',')}) and alive = TRUE and zid = ($1);`,
          [zid],
          (err, results) => {
            if (err) {
              reject(err);
              return;
            }
            if (!results.rows || !results.rows.length) {
              reject(new Error(errorcode));
              return;
            }
            const questions = _.reduce(
              pmqids,
              (o, pmqid) => {
                o[pmqid] = 1;
                return o;
              },
              {}
            );
            results.rows.forEach((row) => {
              delete questions[row.pmqid];
            });
            if (Object.keys(questions).length) {
              reject(new Error(errorcode));
            } else {
              resolve();
            }
          }
        );
      });
    });
  }
  function generateAndReplaceZinvite(zid, generateShortZinvite) {
    let len = 12;
    if (generateShortZinvite) {
      len = 6;
    }
    return new Promise((resolve, reject) => {
      generateToken(len, false, (err, zinvite) => {
        if (err) {
          return reject('polis_err_creating_zinvite');
        }
        pgQuery('update zinvites set zinvite = ($1) where zid = ($2);', [zinvite, zid], (err, _results) => {
          if (err) {
            reject(err);
          } else {
            resolve(zinvite);
          }
        });
      });
    });
  }
  function handle_POST_conversation_close(req, res) {
    let q = 'select * from conversations where zid = ($1)';
    const params = [req.p.zid];
    if (!isPolisDev(req.p.uid)) {
      q = `${q} and owner = ($2)`;
      params.push(req.p.uid);
    }
    pgQueryP(q, params)
      .then((rows) => {
        if (!rows || !rows.length) {
          fail(res, 500, 'polis_err_closing_conversation_no_such_conversation');
          return;
        }
        const conv = rows[0];
        pgQueryP('update conversations set is_active = false where zid = ($1);', [conv.zid]);
      })
      .catch((err) => {
        fail(res, 500, 'polis_err_closing_conversation', err);
      });
  }
  function handle_POST_conversation_reopen(req, res) {
    let q = 'select * from conversations where zid = ($1)';
    const params = [req.p.zid];
    if (!isPolisDev(req.p.uid)) {
      q = `${q} and owner = ($2)`;
      params.push(req.p.uid);
    }
    pgQueryP(q, params)
      .then((rows) => {
        if (!rows || !rows.length) {
          fail(res, 500, 'polis_err_closing_conversation_no_such_conversation');
          return;
        }
        const conv = rows[0];
        pgQueryP('update conversations set is_active = true where zid = ($1);', [conv.zid])
          .then(() => {
            res.status(200).json({});
          })
          .catch((err) => {
            fail(res, 500, 'polis_err_reopening_conversation2', err);
          });
      })
      .catch((err) => {
        fail(res, 500, 'polis_err_reopening_conversation', err);
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
  function handle_PUT_conversations(req, res) {
    const generateShortUrl = req.p.short_url;
    isModerator(req.p.zid, req.p.uid)
      .then((ok) => {
        if (!ok) {
          fail(res, 403, 'polis_err_update_conversation_permission');
          return;
        }
        let verifyMetaPromise;
        if (req.p.verifyMeta) {
          verifyMetaPromise = verifyMetadataAnswersExistForEachQuestion(req.p.zid);
        } else {
          verifyMetaPromise = Promise.resolve();
        }
        const fields = {};
        if (!_.isUndefined(req.p.is_active)) {
          fields.is_active = req.p.is_active;
        }
        if (!_.isUndefined(req.p.is_anon)) {
          fields.is_anon = req.p.is_anon;
        }
        if (!_.isUndefined(req.p.is_draft)) {
          fields.is_draft = req.p.is_draft;
        }
        if (!_.isUndefined(req.p.is_data_open)) {
          fields.is_data_open = req.p.is_data_open;
        }
        if (!_.isUndefined(req.p.profanity_filter)) {
          fields.profanity_filter = req.p.profanity_filter;
        }
        if (!_.isUndefined(req.p.spam_filter)) {
          fields.spam_filter = req.p.spam_filter;
        }
        if (!_.isUndefined(req.p.strict_moderation)) {
          fields.strict_moderation = req.p.strict_moderation;
        }
        if (!_.isUndefined(req.p.topic)) {
          fields.topic = req.p.topic;
        }
        if (!_.isUndefined(req.p.description)) {
          fields.description = req.p.description;
        }
        if (!_.isUndefined(req.p.vis_type)) {
          fields.vis_type = req.p.vis_type;
        }
        if (!_.isUndefined(req.p.help_type)) {
          fields.help_type = req.p.help_type;
        }
        if (!_.isUndefined(req.p.socialbtn_type)) {
          fields.socialbtn_type = req.p.socialbtn_type;
        }
        if (!_.isUndefined(req.p.bgcolor)) {
          if (req.p.bgcolor === 'default') {
            fields.bgcolor = null;
          } else {
            fields.bgcolor = req.p.bgcolor;
          }
        }
        if (!_.isUndefined(req.p.help_color)) {
          if (req.p.help_color === 'default') {
            fields.help_color = null;
          } else {
            fields.help_color = req.p.help_color;
          }
        }
        if (!_.isUndefined(req.p.help_bgcolor)) {
          if (req.p.help_bgcolor === 'default') {
            fields.help_bgcolor = null;
          } else {
            fields.help_bgcolor = req.p.help_bgcolor;
          }
        }
        if (!_.isUndefined(req.p.style_btn)) {
          fields.style_btn = req.p.style_btn;
        }
        if (!_.isUndefined(req.p.write_type)) {
          fields.write_type = req.p.write_type;
        }
        if (!_.isUndefined(req.p.importance_enabled)) {
          fields.importance_enabled = req.p.importance_enabled;
        }
        ifDefinedSet('auth_opt_allow_3rdparty', req.p, fields);
        if (!_.isUndefined(req.p.owner_sees_participation_stats)) {
          fields.owner_sees_participation_stats = !!req.p.owner_sees_participation_stats;
        }
        if (!_.isUndefined(req.p.link_url)) {
          fields.link_url = req.p.link_url;
        }
        ifDefinedSet('subscribe_type', req.p, fields);
        const q = sql_conversations.update(fields).where(sql_conversations.zid.equals(req.p.zid)).returning('*');
        verifyMetaPromise.then(
          () => {
            pgQuery(q.toString(), (err, result) => {
              if (err) {
                fail(res, 500, 'polis_err_update_conversation', err);
                return;
              }
              const conv = result?.rows?.[0];
              conv.is_mod = true;
              const promise = generateShortUrl
                ? generateAndReplaceZinvite(req.p.zid, generateShortUrl)
                : Promise.resolve();
              const successCode = generateShortUrl ? 201 : 200;
              promise
                .then(() => {
                  if (req.p.send_created_email) {
                    Promise.all([getUserInfoForUid2(req.p.uid), getConversationUrl(req, req.p.zid, true)])
                      .then((results) => {
                        const hname = results[0].hname;
                        const url = results[1];
                        sendEmailByUid(
                          req.p.uid,
                          'Conversation created',
                          `Hi ${hname},\n\nHere's a link to the conversation you just created. Use it to invite participants to the conversation. Share it by whatever network you prefer - Gmail, Facebook, Twitter, etc., or just post it to your website or blog. Try it now! Click this link to go to your conversation:\n${url}\n\nWith gratitude,\n\nThe team at pol.is\n`
                        ).catch((err) => {
                          logger.error('polis_err_sending_conversation_created_email', err);
                        });
                      })
                      .catch((err) => {
                        logger.error('polis_err_sending_conversation_created_email', err);
                      });
                  }
                  finishOne(res, conv, true, successCode);
                  updateConversationModifiedTime(req.p.zid);
                })
                .catch((err) => {
                  fail(res, 500, 'polis_err_update_conversation', err);
                });
            });
          },
          (err) => {
            fail(res, 500, err.message, err);
          }
        );
      })
      .catch((err) => {
        fail(res, 500, 'polis_err_update_conversation', err);
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
  function getConversationHasMetadata(zid) {
    return new Promise((resolve, reject) => {
      pgQuery_readOnly(
        'SELECT * from participant_metadata_questions where zid = ($1)',
        [zid],
        (err, metadataResults) => {
          if (err) {
            return reject('polis_err_get_conversation_metadata_by_zid');
          }
          const hasNoMetadata = !metadataResults || !metadataResults.rows || !metadataResults.rows.length;
          resolve(!hasNoMetadata);
        }
      );
    });
  }
  function getConversationTranslations(zid, lang) {
    const firstTwoCharsOfLang = lang.substr(0, 2);
    return pgQueryP('select * from conversation_translations where zid = ($1) and lang = ($2);', [
      zid,
      firstTwoCharsOfLang
    ]);
  }
  function getConversationTranslationsMinimal(zid, lang) {
    if (!lang) {
      return Promise.resolve([]);
    }
    return getConversationTranslations(zid, lang).then((rows) => {
      for (let i = 0; i < rows.length; i++) {
        rows[i].zid = undefined;
        rows[i].created = undefined;
        rows[i].modified = undefined;
        rows[i].src = undefined;
      }
      return rows;
    });
  }
  function getOneConversation(zid, uid, lang) {
    return Promise.all([
      pgQueryP_readOnly(
        'select * from conversations left join  (select uid, site_id from users) as u on conversations.owner = u.uid where conversations.zid = ($1);',
        [zid]
      ),
      getConversationHasMetadata(zid),
      _.isUndefined(uid) ? Promise.resolve({}) : getUserInfoForUid2(uid),
      getConversationTranslationsMinimal(zid, lang)
    ]).then((results) => {
      const conv = results[0]?.[0];
      const convHasMetadata = results[1];
      const requestingUserInfo = results[2];
      const translations = results[3];
      conv.auth_opt_allow_3rdparty = ifDefinedFirstElseSecond(conv.auth_opt_allow_3rdparty, true);
      conv.translations = translations;
      return getUserInfoForUid2(conv.owner).then((ownerInfo) => {
        const ownername = ownerInfo.hname;
        if (convHasMetadata) {
          conv.hasMetadata = true;
        }
        if (!_.isUndefined(ownername) && conv.context !== 'hongkong2014') {
          conv.ownername = ownername;
        }
        conv.is_mod = conv.site_id === requestingUserInfo.site_id;
        conv.is_owner = conv.owner === uid;
        conv.uid = undefined;
        return conv;
      });
    });
  }
  function getConversations(req, res) {
    const uid = req.p.uid;
    const zid = req.p.zid;
    const xid = req.p.xid;
    const include_all_conversations_i_am_in = req.p.include_all_conversations_i_am_in;
    const want_mod_url = req.p.want_mod_url;
    const want_upvoted = req.p.want_upvoted;
    const want_inbox_item_admin_url = req.p.want_inbox_item_admin_url;
    const want_inbox_item_participant_url = req.p.want_inbox_item_participant_url;
    const want_inbox_item_admin_html = req.p.want_inbox_item_admin_html;
    const want_inbox_item_participant_html = req.p.want_inbox_item_participant_html;
    const _context = req.p.context;
    let zidListQuery =
      'select zid, 1 as type from conversations where owner in (select uid from users where site_id = (select site_id from users where uid = ($1)))';
    if (include_all_conversations_i_am_in) {
      zidListQuery += ' UNION ALL select zid, 2 as type from participants where uid = ($1)';
    }
    zidListQuery += ';';
    pgQuery_readOnly(zidListQuery, [uid], (err, results) => {
      if (err) {
        fail(res, 500, 'polis_err_get_conversations_participated_in', err);
        return;
      }
      const participantInOrSiteAdminOf = (results?.rows && _.pluck(results.rows, 'zid')) || null;
      const siteAdminOf = _.filter(results.rows, (row) => row.type === 1);
      const isSiteAdmin = _.indexBy(siteAdminOf, 'zid');
      let query = sql_conversations.select(sql_conversations.star());
      let isRootsQuery = false;
      let orClauses;
      if (!_.isUndefined(req.p.context)) {
        if (req.p.context === '/') {
          orClauses = sql_conversations.is_public.equals(true);
          isRootsQuery = true;
        } else {
          orClauses = sql_conversations.context.equals(req.p.context);
        }
      } else {
        orClauses = sql_conversations.owner.equals(uid);
        if (participantInOrSiteAdminOf.length) {
          orClauses = orClauses.or(sql_conversations.zid.in(participantInOrSiteAdminOf));
        }
      }
      query = query.where(orClauses);
      if (!_.isUndefined(req.p.course_invite)) {
        query = query.and(sql_conversations.course_id.equals(req.p.course_id));
      }
      if (!_.isUndefined(req.p.is_active)) {
        query = query.and(sql_conversations.is_active.equals(req.p.is_active));
      }
      if (!_.isUndefined(req.p.is_draft)) {
        query = query.and(sql_conversations.is_draft.equals(req.p.is_draft));
      }
      if (!_.isUndefined(req.p.zid)) {
        query = query.and(sql_conversations.zid.equals(zid));
      }
      if (isRootsQuery) {
        query = query.and(sql_conversations.context.isNotNull());
      }
      query = query.order(sql_conversations.created.descending);
      if (!_.isUndefined(req.p.limit)) {
        query = query.limit(req.p.limit);
      } else {
        query = query.limit(999);
      }
      pgQuery_readOnly(query.toString(), (err, result) => {
        if (err) {
          fail(res, 500, 'polis_err_get_conversations', err);
          return;
        }
        const data = result.rows || [];
        addConversationIds(data)
          .then((data) => {
            let suurlsPromise;
            if (xid) {
              suurlsPromise = Promise.all(
                data.map((conv) => createOneSuzinvite(xid, conv.zid, conv.owner, _.partial(generateSingleUseUrl, req)))
              );
            } else {
              suurlsPromise = Promise.resolve();
            }
            const upvotesPromise =
              uid && want_upvoted
                ? pgQueryP_readOnly('select zid from upvotes where uid = ($1);', [uid])
                : Promise.resolve();
            return Promise.all([suurlsPromise, upvotesPromise]).then(
              (x) => {
                let suurlData = x[0];
                let upvotes = x[1];
                if (suurlData) {
                  suurlData = _.indexBy(suurlData, 'zid');
                }
                if (upvotes) {
                  upvotes = _.indexBy(upvotes, 'zid');
                }
                data.forEach((conv) => {
                  conv.is_owner = conv.owner === uid;
                  if (want_mod_url) {
                    conv.mod_url = createModerationUrl(conv.conversation_id);
                  }
                  if (want_inbox_item_admin_url) {
                    conv.inbox_item_admin_url = `${serverUrl}/iim/${conv.conversation_id}`;
                  }
                  if (want_inbox_item_participant_url) {
                    conv.inbox_item_participant_url = `${serverUrl}/iip/${conv.conversation_id}`;
                  }
                  if (want_inbox_item_admin_html) {
                    conv.inbox_item_admin_html = `<a href='${serverUrl}/${conv.conversation_id}'>${conv.topic || conv.created}</a> <a href='${serverUrl}/m/${conv.conversation_id}'>moderate</a>`;
                    conv.inbox_item_admin_html_escaped = conv.inbox_item_admin_html.replace(/'/g, "\\'");
                  }
                  if (want_inbox_item_participant_html) {
                    conv.inbox_item_participant_html = `<a href='${serverUrl}/${conv.conversation_id}'>${conv.topic || conv.created}</a>`;
                    conv.inbox_item_participant_html_escaped = conv.inbox_item_admin_html.replace(/'/g, "\\'");
                  }
                  if (suurlData) {
                    conv.url = suurlData[conv.zid || ''].suurl;
                  } else {
                    conv.url = buildConversationUrl(req, conv.conversation_id);
                  }
                  if (upvotes?.[conv.zid || '']) {
                    conv.upvoted = true;
                  }
                  conv.created = Number(conv.created);
                  conv.modified = Number(conv.modified);
                  if (_.isUndefined(conv.topic) || conv.topic === '') {
                    conv.topic = new Date(conv.created).toUTCString();
                  }
                  conv.is_mod = conv.is_owner || isSiteAdmin[conv.zid || ''];
                  conv.zid = undefined;
                  conv.is_anon = undefined;
                  conv.is_draft = undefined;
                  conv.is_public = undefined;
                  if (conv.context === '') {
                    conv.context = undefined;
                  }
                });
                res.status(200).json(data);
              },
              (err) => {
                fail(res, 500, 'polis_err_get_conversations_surls', err);
              }
            );
          })
          .catch((err) => {
            fail(res, 500, 'polis_err_get_conversations_misc', err);
          });
      });
    });
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
  function handle_GET_conversations(req, res) {
    let courseIdPromise = Promise.resolve();
    if (req.p.course_invite) {
      courseIdPromise = pgQueryP_readOnly('select course_id from courses where course_invite = ($1);', [
        req.p.course_invite
      ]).then((rows) => rows[0].course_id);
    }
    courseIdPromise.then((course_id) => {
      if (course_id) {
        req.p.course_id = course_id;
      }
      const lang = null;
      if (req.p.zid) {
        getOneConversation(req.p.zid, req.p.uid, lang)
          .then(
            (data) => {
              finishOne(res, data);
            },
            (err) => {
              fail(res, 500, 'polis_err_get_conversations_2', err);
            }
          )
          .catch((err) => {
            fail(res, 500, 'polis_err_get_conversations_1', err);
          });
      } else if (req.p.uid || req.p.context) {
        getConversations(req, res);
      } else {
        fail(res, 403, 'polis_err_need_auth');
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
  function isUserAllowedToCreateConversations(_uid, callback) {
    callback?.(null, true);
  }
  function handle_POST_reserve_conversation_id(_req, res) {
    const zid = 0;
    const shortUrl = false;
    generateAndRegisterZinvite(zid, shortUrl)
      .then((conversation_id) => {
        res.json({
          conversation_id: conversation_id
        });
      })
      .catch((err) => {
        fail(res, 500, 'polis_err_reserve_conversation_id', err);
      });
  }
  function handle_POST_conversations(req, res) {
    const xidStuffReady = Promise.resolve();
    xidStuffReady
      .then(() => {
        const generateShortUrl = req.p.short_url;
        isUserAllowedToCreateConversations(req.p.uid, (err, isAllowed) => {
          if (err) {
            fail(res, 403, 'polis_err_add_conversation_failed_user_check', err);
            return;
          }
          if (!isAllowed) {
            fail(
              res,
              403,
              'polis_err_add_conversation_not_enabled',
              new Error('polis_err_add_conversation_not_enabled')
            );
            return;
          }
          const q = sql_conversations
            .insert({
              owner: req.p.uid,
              org_id: req.p.org_id || req.p.uid,
              topic: req.p.topic,
              description: req.p.description,
              is_active: req.p.is_active,
              is_data_open: req.p.is_data_open,
              is_draft: req.p.is_draft,
              is_public: true,
              is_anon: req.p.is_anon,
              profanity_filter: req.p.profanity_filter,
              spam_filter: req.p.spam_filter,
              strict_moderation: req.p.strict_moderation,
              context: req.p.context || null,
              owner_sees_participation_stats: !!req.p.owner_sees_participation_stats,
              auth_needed_to_vote: DEFAULTS.auth_needed_to_vote,
              auth_needed_to_write: DEFAULTS.auth_needed_to_write,
              auth_opt_allow_3rdparty: req.p.auth_opt_allow_3rdparty || DEFAULTS.auth_opt_allow_3rdparty
            })
            .returning('*')
            .toString();
          pgQuery(q, [], (err, result) => {
            if (err) {
              if (isDuplicateKey(err)) {
                logger.error('polis_err_add_conversation', err);
                failWithRetryRequest(res);
              } else {
                fail(res, 500, 'polis_err_add_conversation', err);
              }
              return;
            }
            const zid = result?.rows?.[0]?.zid;
            const zinvitePromise = req.p.conversation_id
              ? Conversation.getZidFromConversationId(req.p.conversation_id).then((zid) => {
                  return zid === 0 ? req.p.conversation_id : null;
                })
              : generateAndRegisterZinvite(zid, generateShortUrl);
            zinvitePromise
              .then((zinvite) => {
                if (zinvite === null) {
                  fail(res, 400, 'polis_err_conversation_id_already_in_use', err);
                  return;
                }
                finishOne(res, {
                  url: buildConversationUrl(req, zinvite),
                  zid: zid
                });
              })
              .catch((err) => {
                fail(res, 500, 'polis_err_zinvite_create', err);
              });
          });
        });
      })
      .catch((err) => {
        fail(res, 500, 'polis_err_conversation_create', err);
      });
  }
  function handle_POST_query_participants_by_metadata(req, res) {
    const uid = req.p.uid;
    const zid = req.p.zid;
    const pmaids = req.p.pmaids;
    if (!pmaids.length) {
      return res.status(200).json([]);
    }
    function doneChecking() {
      pgQuery_readOnly(
        `select pid from participants where zid = ($1) and pid not in (select pid from participant_metadata_choices where alive = TRUE and pmaid in (select pmaid from participant_metadata_answers where alive = TRUE and zid = ($2) and pmaid not in (${pmaids.join(',')})));`,
        [zid, zid],
        (err, results) => {
          if (err) {
            fail(res, 500, 'polis_err_metadata_query', err);
            return;
          }
          res.status(200).json(_.pluck(results.rows, 'pid'));
        }
      );
    }
    isOwnerOrParticipant(zid, uid, doneChecking);
  }
  function handle_POST_notifyTeam(req, res) {
    if (req.p.webserver_pass !== Config.webserverPass || req.p.webserver_username !== Config.webserverUsername) {
      return fail(res, 403, 'polis_err_notifyTeam_auth');
    }
    const subject = req.p.subject;
    const body = req.p.body;
    emailTeam(subject, body)
      .then(() => {
        res.status(200).json({});
      })
      .catch((err) => {
        return fail(res, 500, 'polis_err_notifyTeam', err);
      });
  }
  function getSocialParticipantsForMod_timed(zid, limit, mod, convOwner) {
    const _start = Date.now();
    return getSocialParticipantsForMod.apply(null, [zid, limit, mod, convOwner]).then((results) => results);
  }
  function getSocialParticipantsForMod(zid, limit, mod, owner) {
    let modClause = '';
    const params = [zid, limit, owner];
    if (!_.isUndefined(mod)) {
      modClause = ' and mod = ($4)';
      params.push(mod);
    }
    const q = `with p as (select uid, pid, mod from participants where zid = ($1) ${modClause}), final_set as (select * from p limit ($2)), xids_subset as (select * from xids where owner = ($3) and x_profile_image_url is not null), all_rows as (select final_set.mod, xids_subset.x_profile_image_url as x_profile_image_url, xids_subset.xid as xid, xids_subset.x_name as x_name, final_set.pid from final_set left join xids_subset on final_set.uid = xids_subset.uid ) select * from all_rows where (xid is not null) ;`;
    return pgQueryP(q, params);
  }
  const socialParticipantsCache = new LRUCache({
    max: 999
  });
  function getSocialParticipants(zid, uid, limit, mod, math_tick, authorUids) {
    const cacheKey = [zid, limit, mod, math_tick].join('_');
    if (socialParticipantsCache.get(cacheKey)) {
      return socialParticipantsCache.get(cacheKey);
    }
    const authorsQueryParts = (authorUids || []).map(
      (authorUid) => `select ${Number(authorUid)} as uid, 900 as priority`
    );
    let authorsQuery = `(${authorsQueryParts.join(' union ')})`;
    if (!authorUids || authorUids.length === 0) {
      authorsQuery = null;
    }
    const q = `with p as (select uid, pid, mod from participants where zid = ($1) and vote_count >= 1), xids_subset as (select * from xids where owner in (select org_id from conversations where zid = ($1)) and x_profile_image_url is not null), xid_ptpts as (select p.uid, 100 as priority from p inner join xids_subset on xids_subset.uid = p.uid where p.mod >= ($4)), self as (select CAST($2 as INTEGER) as uid, 1000 as priority), ${authorsQuery ? `authors as ${authorsQuery}, ` : ''}pptpts as (select prioritized_ptpts.uid, max(prioritized_ptpts.priority) as priority from ( select * from self ${authorsQuery ? 'union ' + 'select * from authors ' : ''}union select * from xid_ptpts ) as prioritized_ptpts inner join p on prioritized_ptpts.uid = p.uid group by prioritized_ptpts.uid order by priority desc, prioritized_ptpts.uid asc), mod_pptpts as (select asdfasdjfioasjdfoi.uid, max(asdfasdjfioasjdfoi.priority) as priority from ( select * from pptpts union all select uid, 999 as priority from p where mod >= 2) as asdfasdjfioasjdfoi group by asdfasdjfioasjdfoi.uid order by priority desc, asdfasdjfioasjdfoi.uid asc), final_set as (select * from mod_pptpts limit ($3) ) select final_set.priority, xids_subset.x_profile_image_url as x_profile_image_url, xids_subset.xid as xid, xids_subset.x_name as x_name, xids_subset.x_email as x_email, p.pid from final_set left join xids_subset on final_set.uid = xids_subset.uid left join p on final_set.uid = p.uid ;`;
    return pgQueryP_metered_readOnly('getSocialParticipants', q, [zid, uid, limit, mod]).then((response) => {
      socialParticipantsCache.set(cacheKey, response);
      return response;
    });
  }
  const votesForZidPidCache = new LRUCache({
    max: 5000
  });
  function getVotesForZidPidWithTimestampCheck(zid, pid, math_tick) {
    const key = `${zid}_${pid}`;
    const cachedVotes = votesForZidPidCache.get(key);
    if (cachedVotes) {
      const pair = cachedVotes.split(':');
      const cachedTime = Number(pair[0]);
      const votes = pair[1];
      if (cachedTime >= math_tick) {
        return votes;
      }
    }
    return null;
  }
  function cacheVotesForZidPidWithTimestamp(zid, pid, math_tick, votes) {
    const key = `${zid}_${pid}`;
    const val = `${math_tick}:${votes}`;
    votesForZidPidCache.set(key, val);
  }
  function getVotesForZidPidsWithTimestampCheck(zid, pids, math_tick) {
    let cachedVotes = pids.map((pid) => ({
      pid: pid,
      votes: getVotesForZidPidWithTimestampCheck(zid, pid, math_tick)
    }));
    const uncachedPids = cachedVotes.filter((o) => !o.votes).map((o) => o.pid);
    cachedVotes = cachedVotes.filter((o) => !!o.votes);
    function toObj(items) {
      const o = {};
      for (let i = 0; i < items.length; i++) {
        o[items[i].pid] = items[i].votes;
      }
      return o;
    }
    if (uncachedPids.length === 0) {
      return Promise.resolve(toObj(cachedVotes));
    }
    return getVotesForPids(zid, uncachedPids).then((votesRows) => {
      const newPidToVotes = aggregateVotesToPidVotesObj(votesRows);
      _.each(newPidToVotes, (votes, pid) => {
        cacheVotesForZidPidWithTimestamp(zid, pid, math_tick, votes);
      });
      const cachedPidToVotes = toObj(cachedVotes);
      return Object.assign(newPidToVotes, cachedPidToVotes);
    });
  }
  function getVotesForPids(zid, pids) {
    if (pids.length === 0) {
      return Promise.resolve([]);
    }
    return pgQueryP_readOnly(
      `select * from votes where zid = ($1) and pid in (${pids.join(',')}) order by pid, tid, created;`,
      [zid]
    ).then((votesRows) => {
      for (let i = 0; i < votesRows.length; i++) {
        votesRows[i].weight = votesRows[i].weight / 32767;
      }
      return votesRows;
    });
  }
  function createEmptyVoteVector(greatestTid) {
    const a = [];
    for (let i = 0; i <= greatestTid; i++) {
      a[i] = 'u';
    }
    return a;
  }
  function aggregateVotesToPidVotesObj(votes) {
    let i = 0;
    let greatestTid = 0;
    for (i = 0; i < votes.length; i++) {
      if (votes[i].tid > greatestTid) {
        greatestTid = votes[i].tid;
      }
    }
    const vectors = {};
    for (i = 0; i < votes.length; i++) {
      const v = votes[i];
      vectors[v.pid] = vectors[v.pid] || createEmptyVoteVector(greatestTid);
      const vote = v.vote;
      if (polisTypes.reactions.push === vote) {
        vectors[v.pid][v.tid] = 'd';
      } else if (polisTypes.reactions.pull === vote) {
        vectors[v.pid][v.tid] = 'a';
      } else if (polisTypes.reactions.pass === vote) {
        vectors[v.pid][v.tid] = 'p';
      } else {
        logger.error('unknown vote value');
      }
    }
    const vectors2 = {};
    _.each(vectors, (val, key) => {
      vectors2[key] = val.join('');
    });
    return vectors2;
  }
  function getLocationsForParticipants(zid) {
    return pgQueryP_readOnly('select * from participant_locations where zid = ($1);', [zid]);
  }
  function geoCodeWithGoogleApi(locationString) {
    const googleApiKey = Config.googleApiKey;
    const address = encodeURI(locationString);
    if (!googleApiKey) {
      return Promise.reject('polis_err_geocoding_no_api_key');
    }
    return new Promise((resolve, reject) => {
      request
        .get(`https://maps.googleapis.com/maps/api/geocode/json?address=${address}&key=${googleApiKey}`)
        .then((response) => {
          response = JSON.parse(response);
          if (response.status !== 'OK') {
            reject('polis_err_geocoding_failed');
            return;
          }
          const bestResult = response.results[0];
          resolve(bestResult);
        }, reject)
        .catch(reject);
    });
  }
  function geoCode(locationString) {
    return geoCodeWithGoogleApi(locationString).then((result) => {
      const lat = result.geometry.location.lat;
      const lng = result.geometry.location.lng;
      const o = {
        lat: lat,
        lng: lng
      };
      return o;
    });
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
  function removeNullOrUndefinedProperties(o) {
    for (const k in o) {
      const v = o[k];
      if (v === null || v === undefined) {
        delete o[k];
      }
    }
    return o;
  }
  function pullXInfoIntoSubObjects(ptptoiRecord) {
    const p = ptptoiRecord;
    if (p.x_profile_image_url || p.xid || p.x_email) {
      p.xInfo = {};
      p.xInfo.x_profile_image_url = p.x_profile_image_url;
      p.xInfo.xid = p.xid;
      p.xInfo.x_name = p.x_name;
      p.x_profile_image_url = undefined;
      p.xid = undefined;
      p.x_name = undefined;
      p.x_email = undefined;
    }
    return p;
  }
  function handle_PUT_ptptois(req, res) {
    const zid = req.p.zid;
    const uid = req.p.uid;
    const pid = req.p.pid;
    const mod = req.p.mod;
    isModerator(zid, uid)
      .then((isMod) => {
        if (!isMod) {
          fail(res, 403, 'polis_err_ptptoi_permissions_123');
          return;
        }
        return pgQueryP('update participants set mod = ($3) where zid = ($1) and pid = ($2);', [zid, pid, mod]).then(
          () => {
            res.status(200).json({});
          }
        );
      })
      .catch((err) => {
        fail(res, 500, 'polis_err_ptptoi_misc_234', err);
      });
  }
  function handle_GET_ptptois(req, res) {
    const zid = req.p.zid;
    const mod = req.p.mod;
    const uid = req.p.uid;
    const limit = 99999;
    const convPromise = getConversationInfo(req.p.zid);
    const socialPtptsPromise = convPromise.then((conv) => {
      return getSocialParticipantsForMod_timed(zid, limit, mod, conv.owner);
    });
    Promise.all([socialPtptsPromise, getConversationInfo(zid)])
      .then((a) => {
        let ptptois = a[0];
        const conv = a[1];
        const isOwner = uid === conv.owner;
        const isAllowed = isOwner || isPolisDev(req.p.uid) || conv.is_data_open;
        if (isAllowed) {
          ptptois = ptptois.map(pullXInfoIntoSubObjects);
          ptptois = ptptois.map(removeNullOrUndefinedProperties);
          ptptois = ptptois.map((p) => {
            p.conversation_id = req.p.conversation_id;
            return p;
          });
        } else {
          ptptois = [];
        }
        res.status(200).json(ptptois);
      })
      .catch((err) => {
        fail(res, 500, 'polis_err_ptptoi_misc', err);
      });
  }
  function handle_GET_votes_famous(req, res) {
    doFamousQuery(req.p, req)
      .then(
        (data) => {
          res.status(200).json(data);
        },
        (err) => {
          fail(res, 500, 'polis_err_famous_proj_get2', err);
        }
      )
      .catch((err) => {
        fail(res, 500, 'polis_err_famous_proj_get1', err);
      });
  }
  function doFamousQuery(o, _req) {
    const uid = o?.uid;
    const zid = o?.zid;
    const math_tick = o?.math_tick;
    const hardLimit = _.isUndefined(o?.ptptoiLimit) ? 30 : o?.ptptoiLimit;
    const mod = 0;
    function getAuthorUidsOfFeaturedComments() {
      return getPca(zid, 0).then((pcaResult) => {
        if (!pcaResult || typeof pcaResult !== 'object' || pcaResult === null || !('asPOJO' in pcaResult)) {
          return [];
        }
        const pcaData = pcaResult.asPOJO;
        pcaData.consensus = pcaData.consensus || {};
        pcaData.consensus.agree = pcaData.consensus.agree || [];
        pcaData.consensus.disagree = pcaData.consensus.disagree || [];
        const consensusTids = _.union(
          _.pluck(pcaData.consensus.agree, 'tid'),
          _.pluck(pcaData.consensus.disagree, 'tid')
        );
        let groupTids = [];
        for (const gid in pcaData.repness) {
          const commentData = pcaData.repness[gid];
          groupTids = _.union(groupTids, _.pluck(commentData, 'tid'));
        }
        let featuredTids = _.union(consensusTids, groupTids);
        featuredTids.sort();
        featuredTids = _.uniq(featuredTids);
        if (featuredTids.length === 0) {
          return [];
        }
        const q = `with authors as (select distinct(uid) from comments where zid = ($1) and tid in (${featuredTids.join(',')}) order by uid) select authors.uid from authors inner join xids on xids.uid = authors.uid order by uid;`;
        return pgQueryP_readOnly(q, [zid]).then((comments) => {
          let uids = _.pluck(comments, 'uid');
          uids = _.uniq(uids);
          return uids;
        });
      });
    }
    return Promise.all([getConversationInfo(zid), getAuthorUidsOfFeaturedComments()]).then((a) => {
      const conv = a[0];
      const authorUids = a[1];
      if (conv.is_anon) {
        return {};
      }
      return Promise.all([getSocialParticipants(zid, uid, hardLimit, mod, math_tick, authorUids)]).then((stuff) => {
        let participantsWithSocialInfo = stuff[0] || [];
        participantsWithSocialInfo = participantsWithSocialInfo.map((p) => {
          const x = pullXInfoIntoSubObjects(p);
          if (p.priority === 1000) {
            x.isSelf = true;
          }
          return x;
        });
        let pids = participantsWithSocialInfo.map((p) => p.pid);
        const pidToData = _.indexBy(participantsWithSocialInfo, 'pid');
        pids.sort((a, b) => a - b);
        pids = _.uniq(pids, true);
        return getVotesForZidPidsWithTimestampCheck(zid, pids, math_tick).then((vectors) =>
          getBidsForPids(zid, -1, pids).then(
            (pidsToBids) => {
              _.each(vectors, (value, pid, _list) => {
                pid = Number.parseInt(pid);
                const bid = pidsToBids[pid];
                const notInBucket = _.isUndefined(bid);
                const isSelf = pidToData[pid].isSelf;
                if (notInBucket && !isSelf) {
                  delete pidToData[pid];
                } else if (pidToData[pid]) {
                  pidToData[pid].votes = value;
                  pidToData[pid].bid = bid;
                }
              });
              return pidToData;
            },
            (_err) => ({})
          )
        );
      });
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
  function generateSingleUseUrl(_req, conversation_id, suzinvite) {
    return `${serverUrl}/ot/${conversation_id}/${suzinvite}`;
  }
  function buildConversationUrl(_req, zinvite) {
    return `${serverUrl}/${zinvite}`;
  }
  function buildConversationDemoUrl(_req, zinvite) {
    return `${serverUrl}/demo/${zinvite}`;
  }
  function buildModerationUrl(_req, zinvite) {
    return `${serverUrl}/m/${zinvite}`;
  }
  function buildSeedUrl(req, zinvite) {
    return `${buildModerationUrl(req, zinvite)}/comments/seed`;
  }
  function getConversationUrl(req, zid, dontUseCache) {
    return getZinvite(zid, dontUseCache).then((zinvite) => buildConversationUrl(req, zinvite));
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
  function initializeImplicitConversation(site_id, page_id, o) {
    return pgQueryP_readOnly('select uid from users where site_id = ($1) and site_owner = TRUE;', [site_id]).then(
      (rows) => {
        if (!rows || !rows.length) {
          throw new Error('polis_err_bad_site_id');
        }
        return new Promise((resolve, reject) => {
          const uid = rows[0].uid;
          const generateShortUrl = false;
          isUserAllowedToCreateConversations(uid, (err, isAllowed) => {
            if (err) {
              reject(err);
              return;
            }
            if (!isAllowed) {
              reject(err);
              return;
            }
            const params = Object.assign(o, {
              owner: uid,
              org_id: uid,
              is_active: true,
              is_draft: false,
              is_public: true,
              is_anon: false,
              profanity_filter: true,
              spam_filter: true,
              strict_moderation: false,
              owner_sees_participation_stats: false
            });
            const q = sql_conversations.insert(params).returning('*').toString();
            pgQuery(q, [], (err, result) => {
              if (err) {
                if (isDuplicateKey(err)) {
                  logger.error('polis_err_create_implicit_conv_duplicate_key', err);
                  reject('polis_err_create_implicit_conv_duplicate_key');
                } else {
                  reject('polis_err_create_implicit_conv_db');
                }
              }
              const zid = result?.rows?.[0]?.zid;
              Promise.all([registerPageId(site_id, page_id, zid), generateAndRegisterZinvite(zid, generateShortUrl)])
                .then((o) => {
                  const zinvite = o[1];
                  resolve({
                    owner: uid,
                    zid: zid,
                    zinvite: zinvite
                  });
                })
                .catch((err) => {
                  reject('polis_err_zinvite_create_implicit', err);
                });
            });
          });
        });
      }
    );
  }
  function registerPageId(site_id, page_id, zid) {
    return pgQueryP('insert into page_ids (site_id, page_id, zid) values ($1, $2, $3);', [site_id, page_id, zid]);
  }
  function doGetConversationPreloadInfo(conversation_id) {
    return Conversation.getZidFromConversationId(conversation_id)
      .then((zid) => Promise.all([getConversationInfo(zid)]))
      .then((a) => {
        let conv = a[0];
        const auth_opt_allow_3rdparty = ifDefinedFirstElseSecond(
          conv.auth_opt_allow_3rdparty,
          DEFAULTS.auth_opt_allow_3rdparty
        );
        conv = {
          topic: conv.topic,
          description: conv.description,
          created: conv.created,
          link_url: conv.link_url,
          parent_url: conv.parent_url,
          vis_type: conv.vis_type,
          write_type: conv.write_type,
          importance_enabled: conv.importance_enabled,
          help_type: conv.help_type,
          socialbtn_type: conv.socialbtn_type,
          bgcolor: conv.bgcolor,
          help_color: conv.help_color,
          help_bgcolor: conv.help_bgcolor,
          style_btn: conv.style_btn,
          auth_needed_to_vote: false,
          auth_needed_to_write: false,
          auth_opt_allow_3rdparty: auth_opt_allow_3rdparty
        };
        conv.conversation_id = conversation_id;
        return conv;
      });
  }
  function handle_GET_conversationPreloadInfo(req, res) {
    return doGetConversationPreloadInfo(req.p.conversation_id).then(
      (conv) => {
        res.status(200).json(conv);
      },
      (err) => {
        fail(res, 500, 'polis_err_get_conversation_preload_info', err);
      }
    );
  }
  function handle_GET_implicit_conversation_generation(req, res) {
    let site_id = /polis_site_id[^/]*/.exec(req.path) || null;
    let page_id = /\S\/([^/]*)/.exec(req.path) || null;
    if (!site_id?.length || (page_id && page_id?.length < 2)) {
      fail(res, 404, 'polis_err_parsing_site_id_or_page_id');
    }
    site_id = site_id?.[0];
    page_id = page_id?.[1];
    const demo = req.p.demo;
    const ucv = req.p.ucv;
    const ucw = req.p.ucw;
    const ucsh = req.p.ucsh;
    const ucst = req.p.ucst;
    const ucsd = req.p.ucsd;
    const ucsv = req.p.ucsv;
    const ucsf = req.p.ucsf;
    const ui_lang = req.p.ui_lang;
    const subscribe_type = req.p.subscribe_type;
    const xid = req.p.xid;
    const x_name = req.p.x_name;
    const x_profile_image_url = req.p.x_profile_image_url;
    const x_email = req.p.x_email;
    const parent_url = req.p.parent_url;
    const dwok = req.p.dwok;
    const o = {};
    ifDefinedSet('parent_url', req.p, o);
    ifDefinedSet('auth_opt_allow_3rdparty', req.p, o);
    ifDefinedSet('topic', req.p, o);
    if (!_.isUndefined(req.p.show_vis)) {
      o.vis_type = req.p.show_vis ? 1 : 0;
    }
    if (!_.isUndefined(req.p.bg_white)) {
      o.bgcolor = req.p.bg_white ? '#fff' : null;
    }
    o.socialbtn_type = req.p.show_share ? 1 : 0;
    if (req.p.referrer) {
      setParentReferrerCookie(req, res, req.p.referrer);
    }
    if (req.p.parent_url) {
      setParentUrlCookie(req, res, req.p.parent_url);
    }
    function appendParams(url) {
      url += `?site_id=${site_id}&page_id=${page_id}`;
      if (!_.isUndefined(ucv)) {
        url += `&ucv=${ucv}`;
      }
      if (!_.isUndefined(ucw)) {
        url += `&ucw=${ucw}`;
      }
      if (!_.isUndefined(ucst)) {
        url += `&ucst=${ucst}`;
      }
      if (!_.isUndefined(ucsd)) {
        url += `&ucsd=${ucsd}`;
      }
      if (!_.isUndefined(ucsv)) {
        url += `&ucsv=${ucsv}`;
      }
      if (!_.isUndefined(ucsf)) {
        url += `&ucsf=${ucsf}`;
      }
      if (!_.isUndefined(ui_lang)) {
        url += `&ui_lang=${ui_lang}`;
      }
      if (!_.isUndefined(ucsh)) {
        url += `&ucsh=${ucsh}`;
      }
      if (!_.isUndefined(subscribe_type)) {
        url += `&subscribe_type=${subscribe_type}`;
      }
      if (!_.isUndefined(xid)) {
        url += `&xid=${xid}`;
      }
      if (!_.isUndefined(x_name)) {
        url += `&x_name=${encodeURIComponent(x_name)}`;
      }
      if (!_.isUndefined(x_profile_image_url)) {
        url += `&x_profile_image_url=${encodeURIComponent(x_profile_image_url)}`;
      }
      if (!_.isUndefined(x_email)) {
        url += `&x_email=${encodeURIComponent(x_email)}`;
      }
      if (!_.isUndefined(parent_url)) {
        url += `&parent_url=${encodeURIComponent(parent_url)}`;
      }
      if (!_.isUndefined(dwok)) {
        url += `&dwok=${dwok}`;
      }
      return url;
    }
    pgQueryP_readOnly('select * from page_ids where site_id = ($1) and page_id = ($2);', [site_id, page_id])
      .then((rows) => {
        if (!rows || !rows.length) {
          initializeImplicitConversation(site_id, page_id, o)
            .then((conv) => {
              let url = _.isUndefined(demo)
                ? buildConversationUrl(req, conv.zinvite)
                : buildConversationDemoUrl(req, conv.zinvite);
              const modUrl = buildModerationUrl(req, conv.zinvite);
              const seedUrl = buildSeedUrl(req, conv.zinvite);
              sendImplicitConversationCreatedEmails(site_id, page_id, url, modUrl, seedUrl)
                .then(() => {
                  logger.info('email sent');
                })
                .catch((err) => {
                  logger.error('email fail', err);
                });
              url = appendParams(url);
              res.redirect(url);
            })
            .catch((err) => {
              fail(res, 500, 'polis_err_creating_conv', err);
            });
        } else {
          getZinvite(rows[0].zid)
            .then((conversation_id) => {
              let url = buildConversationUrl(req, conversation_id);
              url = appendParams(url);
              res.redirect(url);
            })
            .catch((err) => {
              fail(res, 500, 'polis_err_finding_conversation_id', err);
            });
        }
      })
      .catch((err) => {
        fail(res, 500, 'polis_err_redirecting_to_conv', err);
      });
  }
  const routingProxy = new httpProxy.createProxyServer();
  function addStaticFileHeaders(res) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', 0);
  }
  function proxy(req, res) {
    const hostname = Config.staticFilesHost;
    if (!hostname) {
      const host = req?.headers?.host || '';
      const re = new RegExp(`${Config.getServerHostname()}$`);
      if (host.match(re)) {
        fail(res, 500, 'polis_err_proxy_serving_to_domain', new Error(host));
      } else {
        fail(res, 500, 'polis_err_proxy_serving_to_domain', new Error(host));
      }
      return;
    }
    if (devMode) {
      addStaticFileHeaders(res);
    }
    const port = Config.staticFilesParticipationPort;
    if (req?.headers?.host) req.headers.host = hostname;
    routingProxy.web(req, res, {
      target: {
        host: hostname,
        port: port
      }
    });
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
  function makeFileFetcher(_hostname, port, path, headers, preloadData) {
    return (req, res) => {
      const hostname = Config.staticFilesHost;
      if (!hostname) {
        fail(res, 500, 'polis_err_file_fetcher_serving_to_domain');
        return;
      }
      const url = `http://${hostname}:${port}${path}`;
      logger.info(`fetch file from ${url}`);
      let x = request(url);
      req.pipe(x);
      if (!_.isUndefined(preloadData)) {
        x = x.pipe(replaceStream('"REPLACE_THIS_WITH_PRELOAD_DATA"', JSON.stringify(preloadData)));
      }
      let fbMetaTagsString = '<meta property="og:image" content="https://s3.amazonaws.com/pol.is/polis_logo.png" />\n';
      if (preloadData?.conversation) {
        fbMetaTagsString += `    <meta property="og:title" content="${encode(preloadData.conversation.topic)}" />\n`;
        fbMetaTagsString += `    <meta property="og:description" content="${encode(preloadData.conversation.description)}" />\n`;
      }
      x = x.pipe(replaceStream('<!-- REPLACE_THIS_WITH_FB_META_TAGS -->', fbMetaTagsString));
      res.set(headers);
      x.pipe(res);
      x.on('error', (err) => {
        fail(res, 500, `polis_err_finding_file ${path}`, err);
      });
    };
  }
  function isUnsupportedBrowser(req) {
    return /MSIE [234567]/.test(req?.headers?.['user-agent'] || '');
  }
  function browserSupportsPushState(req) {
    return !/MSIE [23456789]/.test(req?.headers?.['user-agent'] || '');
  }
  const hostname = Config.staticFilesHost;
  const staticFilesParticipationPort = Config.staticFilesParticipationPort;
  const staticFilesAdminPort = Config.staticFilesAdminPort;
  const fetchUnsupportedBrowserPage = makeFileFetcher(
    hostname,
    staticFilesParticipationPort,
    '/unsupportedBrowser.html',
    {
      'Content-Type': 'text/html'
    }
  );
  function fetchIndex(req, res, preloadData, port) {
    const headers = {
      'Content-Type': 'text/html'
    };
    if (!devMode) {
      Object.assign(headers, {
        'Cache-Control': 'no-cache'
      });
    }
    setCookieTestCookie(req, res);
    const indexPath = '/index.html';
    const doFetch = makeFileFetcher(hostname, port, indexPath, headers, preloadData);
    if (isUnsupportedBrowser(req)) {
      return fetchUnsupportedBrowserPage(req, res);
    }
    if (!browserSupportsPushState(req) && req.path.length > 1 && !/^\/api/.exec(req.path)) {
      res.writeHead(302, {
        Location: `https://${req?.headers?.host}/#${req.path}`
      });
      return res.end();
    }
    return doFetch(req, res);
  }
  function fetchIndexWithoutPreloadData(req, res, port) {
    return fetchIndex(req, res, {}, port);
  }
  function ifDefinedFirstElseSecond(first, second) {
    return _.isUndefined(first) ? second : first;
  }
  const fetch404Page = makeFileFetcher(hostname, staticFilesAdminPort, '/404.html', {
    'Content-Type': 'text/html'
  });
  function fetchIndexForConversation(req, res) {
    logger.debug('fetchIndexForConversation', req.path);
    const match = req.path.match(/[0-9][0-9A-Za-z]+/);
    let conversation_id;
    if (match?.length) {
      conversation_id = match[0];
    }
    doGetConversationPreloadInfo(conversation_id)
      .then((x) => {
        const preloadData = {
          conversation: x
        };
        fetchIndex(req, res, preloadData, staticFilesParticipationPort);
      })
      .catch((err) => {
        logger.error('polis_err_fetching_conversation_info', err);
        fetch404Page(req, res);
      });
  }
  const fetchIndexForAdminPage = makeFileFetcher(hostname, staticFilesAdminPort, '/index_admin.html', {
    'Content-Type': 'text/html'
  });
  const fetchIndexForReportPage = makeFileFetcher(hostname, staticFilesAdminPort, '/index_report.html', {
    'Content-Type': 'text/html'
  });
  function handle_GET_iip_conversation(req, res) {
    const conversation_id = req.params.conversation_id;
    res.set({
      'Content-Type': 'text/html'
    });
    res.send(`<a href='https://pol.is/${conversation_id}' target='_blank'>${conversation_id}</a>`);
  }
  function handle_GET_iim_conversation(req, res) {
    const zid = req.p.zid;
    const conversation_id = req.params.conversation_id;
    getConversationInfo(zid)
      .then((info) => {
        res.set({
          'Content-Type': 'text/html'
        });
        const title = info.topic || info.created;
        res.send(
          `<a href='https://pol.is/${conversation_id}' target='_blank'>${title}</a><p><a href='https://pol.is/m${conversation_id}' target='_blank'>moderate</a></p>${info.description ? `<p>${info.description}</p>` : ''}`
        );
      })
      .catch((err) => {
        fail(res, 500, 'polis_err_fetching_conversation_info', err);
      });
  }
  const handle_GET_conditionalIndexFetcher = (() => (req, res) => {
    if (hasAuthToken(req)) {
      return fetchIndexForAdminPage(req, res);
    }
    if (!browserSupportsPushState(req)) {
      return fetchIndexForAdminPage(req, res);
    }
    const url = `${serverUrl}/home`;
    res.redirect(url);
  })();
  function middleware_log_request_body(req, _res, next) {
    if (devMode) {
      let b = '';
      if (req.body) {
        const temp = _.clone(req.body);
        if (temp.password) {
          temp.password = 'some_password';
        }
        if (temp.newPassword) {
          temp.newPassword = 'some_password';
        }
        if (temp.password2) {
          temp.password2 = 'some_password';
        }
        if (temp.hname) {
          temp.hname = 'somebody';
        }
        if (temp.polisApiKey) {
          temp.polisApiKey = 'pkey_somePolisApiKey';
        }
        b = JSON.stringify(temp);
      }
      if (req.path !== '/api/v3/math/pca2') {
        logger.debug('middleware_log_request_body', { path: req.path, body: b });
      }
    }
    next();
  }
  function middleware_log_middleware_errors(err, _req, _res, next) {
    if (!err) {
      return next();
    }
    logger.error('middleware_log_middleware_errors', err);
    next(err);
  }
  function middleware_check_if_options(req, res, next) {
    if (req.method.toLowerCase() !== 'options') {
      return next();
    }
    return res.send(204);
  }
  const middleware_responseTime_start = responseTime((req, _res, time) => {
    if (req?.route?.path) {
      const path = req.route.path;
      time = Math.trunc(time);
      addInRamMetric(path, time);
    }
  });
  logger.debug('end initializePolisHelpers');
  const returnObject = {
    auth,
    authOptional,
    COOKIES,
    devMode,
    enableAgid,
    fail,
    fetchThirdPartyCookieTestPt1,
    fetchThirdPartyCookieTestPt2,
    fetchIndexForAdminPage,
    fetchIndexForConversation,
    fetchIndexForReportPage,
    fetchIndexWithoutPreloadData,
    finishArray,
    getPidForParticipant,
    haltOnTimeout,
    HMAC_SIGNATURE_PARAM_NAME,
    hostname,
    makeFileFetcher,
    makeRedirectorTo,
    pidCache,
    staticFilesAdminPort,
    staticFilesParticipationPort,
    proxy,
    redirectIfHasZidButNoConversationId,
    redirectIfNotHttps,
    sendTextEmail,
    timeout,
    writeDefaultHead,
    middleware_check_if_options,
    middleware_log_middleware_errors,
    middleware_log_request_body,
    middleware_responseTime_start,
    handle_DELETE_metadata_answers,
    handle_DELETE_metadata_questions,
    handle_GET_bid,
    handle_GET_bidToPid,
    handle_GET_conditionalIndexFetcher,
    handle_GET_contexts,
    handle_GET_conversationPreloadInfo,
    handle_GET_conversations,
    handle_GET_conversationsRecentActivity,
    handle_GET_conversationsRecentlyStarted,
    handle_GET_conversationStats,
    handle_GET_math_correlationMatrix,
    handle_GET_dataExport,
    handle_GET_dataExport_results,
    handle_GET_reportExport,
    handle_GET_dummyButton,
    handle_GET_einvites,
    handle_GET_iim_conversation,
    handle_GET_iip_conversation,
    handle_GET_implicit_conversation_generation,
    handle_GET_launchPrep,
    handle_GET_locations,
    handle_GET_math_pca,
    handle_GET_math_pca2,
    handle_GET_metadata,
    handle_GET_metadata_answers,
    handle_GET_metadata_choices,
    handle_GET_metadata_questions,
    handle_GET_participants,
    handle_GET_participation,
    handle_GET_participationInit,
    handle_GET_perfStats,
    handle_GET_ptptois,
    handle_GET_reports,
    handle_GET_reportNarrative,
    handle_GET_snapshot,
    handle_GET_testConnection,
    handle_GET_testDatabase,
    handle_GET_tryCookie,
    handle_GET_users,
    handle_GET_votes,
    handle_GET_votes_famous,
    handle_GET_votes_me,
    handle_GET_xids,
    handle_GET_zinvites,
    handle_POST_auth_deregister,
    handle_POST_auth_login,
    handle_POST_auth_new,
    handle_POST_auth_password,
    handle_POST_auth_pwresettoken,
    handle_POST_contexts,
    handle_POST_contributors,
    handle_POST_conversation_close,
    handle_POST_conversation_reopen,
    handle_POST_conversations,
    handle_POST_convSubscriptions,
    handle_POST_einvites,
    handle_POST_joinWithInvite,
    handle_POST_math_update,
    handle_POST_metadata_answers,
    handle_POST_metadata_questions,
    handle_POST_metrics,
    handle_POST_notifyTeam,
    handle_POST_participants,
    handle_POST_query_participants_by_metadata,
    handle_POST_reports,
    handle_POST_reserve_conversation_id,
    handle_POST_stars,
    handle_POST_trashes,
    handle_POST_tutorial,
    handle_POST_upvotes,
    handle_POST_votes,
    handle_POST_xidWhitelist,
    handle_POST_zinvites,
    handle_PUT_conversations,
    handle_PUT_participants_extended,
    handle_PUT_ptptois,
    handle_PUT_reports,
    handle_PUT_users
  };
  return returnObject;
}
export { initializePolisHelpers };
export default { initializePolisHelpers };
