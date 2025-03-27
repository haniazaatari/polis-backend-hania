import url from 'url';
import _ from 'underscore';
import Config from '../config.js';
import Session from '../session.js';
import User from '../user.js';
import logger from '../utils/logger.js';

const COOKIES = {
  COOKIE_TEST: 'ct',
  HAS_EMAIL: 'e',
  TOKEN: 'token2',
  UID: 'uid2',
  REFERRER: 'ref',
  PARENT_REFERRER: 'referrer',
  PARENT_URL: 'parent_url',
  USER_CREATED_TIMESTAMP: 'uc',
  PERMANENT_COOKIE: 'pc',
  TRY_COOKIE: 'tryCookie'
};

const getUserInfoForSessionToken = Session.getUserInfoForSessionToken;

const COOKIES_TO_CLEAR = {
  e: true,
  token2: true,
  uid2: true,
  uc: true,
  referrer: true,
  parent_url: true
};

const oneYear = 1000 * 60 * 60 * 24 * 365;

function cookieDomain(req) {
  const origin = req?.headers?.origin || '';
  const parsedOrigin = url.parse(origin);
  if (parsedOrigin.hostname === 'localhost') {
    return 'localhost';
  }
  return `.${Config.getServerHostname()}`;
}

function setCookie(req, res, name, value, options) {
  const opts = _.clone(options || {});
  opts.path = _.isUndefined(opts.path) ? '/' : opts.path;
  opts.maxAge = _.isUndefined(opts.maxAge) ? oneYear : opts.maxAge;
  const origin = req?.headers?.origin || '';
  const parsedOrigin = url.parse(origin);
  opts.secure = parsedOrigin.protocol === 'https:';
  opts.domain = cookieDomain(req);
  res.cookie(name, value, opts);
}

function setParentReferrerCookie(req, res, referrer) {
  setCookie(req, res, COOKIES.PARENT_REFERRER, referrer, {
    httpOnly: true
  });
}

function setParentUrlCookie(req, res, parent_url) {
  setCookie(req, res, COOKIES.PARENT_URL, parent_url, {
    httpOnly: true
  });
}

function setHasEmailCookie(req, res, email) {
  if (email) {
    setCookie(req, res, COOKIES.HAS_EMAIL, 1, {});
  }
}

function setUserCreatedTimestampCookie(req, res, timestamp) {
  setCookie(req, res, COOKIES.USER_CREATED_TIMESTAMP, timestamp, {});
}

function setTokenCookie(req, res, token) {
  setCookie(req, res, COOKIES.TOKEN, token, {
    httpOnly: true
  });
}

function setUidCookie(req, res, uid) {
  setCookie(req, res, COOKIES.UID, uid, {});
}

function setPermanentCookie(req, res, token) {
  setCookie(req, res, COOKIES.PERMANENT_COOKIE, token, {
    httpOnly: true
  });
}

function setCookieTestCookie(req, res) {
  setCookie(req, res, COOKIES.COOKIE_TEST, 1, {});
}

function addCookies(req, res, token, uid) {
  return User.getUserInfoForUid2(uid).then((opts) => {
    const email = opts.email;
    const created = opts.created;
    setTokenCookie(req, res, token);
    setUidCookie(req, res, uid);
    setHasEmailCookie(req, res, email);
    setUserCreatedTimestampCookie(req, res, created);
    if (!req.cookies[COOKIES.PERMANENT_COOKIE]) {
      setPermanentCookie(req, res, Session.makeSessionToken());
    }
    res.header('x-polis', token);
  });
}

function getPermanentCookieAndEnsureItIsSet(req, res) {
  if (!req.cookies[COOKIES.PERMANENT_COOKIE]) {
    const token = Session.makeSessionToken();
    setPermanentCookie(req, res, token);
    return token;
  }
  return req.cookies[COOKIES.PERMANENT_COOKIE];
}

function clearCookies(req, res) {
  let cookieName;
  for (cookieName in req.cookies) {
    if (COOKIES_TO_CLEAR[cookieName]) {
      res?.clearCookie?.(cookieName, {
        path: '/',
        domain: cookieDomain(req)
      });
    }
  }
  logger.info(`after clear res set-cookie: ${JSON.stringify(res?._headers?.['set-cookie'])}`);
}

function clearCookie(req, res, cookieName) {
  res?.clearCookie?.(cookieName, {
    path: '/',
    domain: cookieDomain(req)
  });
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

export default {
  COOKIES,
  COOKIES_TO_CLEAR,
  cookieDomain,
  setCookie,
  setParentReferrerCookie,
  setParentUrlCookie,
  setPermanentCookie,
  setCookieTestCookie,
  addCookies,
  getPermanentCookieAndEnsureItIsSet,
  clearCookies,
  clearCookie,
  doCookieAuth
};
