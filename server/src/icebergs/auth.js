import bcrypt from 'bcryptjs';
import _ from 'underscore';
import { createUser } from '../auth/create-user.js';
import { getConversationInfoByConversationId } from '../conversation.js';
import { query as pgQuery, queryP_readOnly_wRetryIfEmpty as pgQueryP_readOnly_wRetryIfEmpty } from '../db/pg-query.js';
import { getUserInfoForSessionToken, startSession } from '../session.js';
import { endSession, startSessionAndAddCookies } from '../session.js';
import { getXidRecordByXidOwnerId } from '../user.js';
import { createDummyUser } from '../user.js';
import { COOKIES, addCookies, clearCookies } from '../utils/cookies.js';
import { fail } from '../utils/fail.js';
import logger from '../utils/logger.js';

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

function getUidForApiKey(apikey) {
  return pgQueryP_readOnly_wRetryIfEmpty('select uid from apikeysndvweifu WHERE apikey = ($1);', [apikey]);
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

function _enableAgid(req, _res, next) {
  req.body.agid = 1;
  next();
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

function handle_POST_auth_new(req, res) {
  createUser(req, res);
}

export default {
  auth,
  authOptional,
  handle_POST_auth_deregister,
  handle_POST_auth_login,
  handle_POST_auth_new
};
