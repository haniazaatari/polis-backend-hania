import url from 'url';
import _ from 'underscore';
import Config from '../../config.js';
import logger from '../../utils/logger.js';
import { getUserInfoForUid2 } from '../userService.js';
import { COOKIES, COOKIES_TO_CLEAR } from './constants.js';
import { generateSessionToken } from './sessionService.js';

const oneYear = 1000 * 60 * 60 * 24 * 365;

/**
 * Determines the cookie domain based on the request
 * @param {Object} req - Express request object
 * @returns {string} - The cookie domain
 */
function cookieDomain(req) {
  const origin = req?.headers?.origin || '';
  const parsedOrigin = url.parse(origin);

  if (parsedOrigin.hostname === 'localhost') {
    return 'localhost';
  }

  return `.${Config.getServerHostname()}`;
}

/**
 * Sets a cookie on the response
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} name - Cookie name
 * @param {string|number} value - Cookie value
 * @param {Object} options - Cookie options
 */
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

/**
 * Sets the parent referrer cookie
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} referrer - Referrer URL
 */
function setParentReferrerCookie(req, res, referrer) {
  setCookie(req, res, COOKIES.PARENT_REFERRER, referrer, {
    httpOnly: true
  });
}

/**
 * Sets the parent URL cookie
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} parent_url - Parent URL
 */
function setParentUrlCookie(req, res, parent_url) {
  setCookie(req, res, COOKIES.PARENT_URL, parent_url, {
    httpOnly: true
  });
}

/**
 * Sets the has email cookie
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} email - User email
 */
function setHasEmailCookie(req, res, email) {
  if (email) {
    setCookie(req, res, COOKIES.HAS_EMAIL, 1, {});
  }
}

/**
 * Sets the user created timestamp cookie
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {number} timestamp - User creation timestamp
 */
function setUserCreatedTimestampCookie(req, res, timestamp) {
  setCookie(req, res, COOKIES.USER_CREATED_TIMESTAMP, timestamp, {});
}

/**
 * Sets the token cookie
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} token - Session token
 */
function setTokenCookie(req, res, token) {
  setCookie(req, res, COOKIES.TOKEN, token, {
    httpOnly: true
  });
}

/**
 * Sets the UID cookie
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {number} uid - User ID
 */
function setUidCookie(req, res, uid) {
  setCookie(req, res, COOKIES.UID, uid, {});
}

/**
 * Sets the permanent cookie
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} token - Permanent token
 */
function setPermanentCookie(req, res, token) {
  setCookie(req, res, COOKIES.PERMANENT_COOKIE, token, {
    httpOnly: true
  });
}

/**
 * Sets the cookie test cookie
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
function setCookieTestCookie(req, res) {
  setCookie(req, res, COOKIES.COOKIE_TEST, 1, {});
}

/**
 * Adds all necessary cookies for a user session
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} token - Session token
 * @param {number} uid - User ID
 * @returns {Promise<void>}
 */
async function addCookies(req, res, token, uid) {
  const userInfo = await getUserInfoForUid2(uid);
  const email = userInfo.email;
  const created = userInfo.created;

  setTokenCookie(req, res, token);
  setUidCookie(req, res, uid);
  setHasEmailCookie(req, res, email);
  setUserCreatedTimestampCookie(req, res, created);

  if (!req.cookies[COOKIES.PERMANENT_COOKIE]) {
    setPermanentCookie(req, res, generateSessionToken());
  }

  res.header('x-polis', token);
}

/**
 * Gets the permanent cookie and ensures it is set
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {string} - The permanent cookie token
 */
function getPermanentCookieAndEnsureItIsSet(req, res) {
  if (!req.cookies[COOKIES.PERMANENT_COOKIE]) {
    const token = generateSessionToken();
    setPermanentCookie(req, res, token);
    return token;
  }

  return req.cookies[COOKIES.PERMANENT_COOKIE];
}

/**
 * Clears all cookies
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
function clearCookies(req, res) {
  if (!res) return;

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

/**
 * Clears a specific cookie
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} cookieName - Name of the cookie to clear
 */
function clearCookie(req, res, cookieName) {
  if (!res) return;

  res?.clearCookie?.(cookieName, {
    path: '/',
    domain: cookieDomain(req)
  });
}

/**
 * Adds authentication cookies to the response
 * @param {Object} res - Express response object
 * @param {string} token - Session token
 * @param {number} uid - User ID
 */
function addAuthCookies(res, token, uid) {
  res.cookie(COOKIES.TOKEN, token, {
    path: '/',
    maxAge: oneYear,
    httpOnly: true
  });

  res.cookie(COOKIES.UID, uid, {
    path: '/',
    maxAge: oneYear
  });
}

/**
 * Clears authentication cookies from the response
 * @param {Object} res - Express response object
 */
function clearAuthCookies(res) {
  res.clearCookie(COOKIES.TOKEN, { path: '/' });
  res.clearCookie(COOKIES.UID, { path: '/' });
}

export {
  COOKIES_TO_CLEAR,
  COOKIES,
  addAuthCookies,
  addCookies,
  clearAuthCookies,
  clearCookie,
  clearCookies,
  cookieDomain,
  getPermanentCookieAndEnsureItIsSet,
  setCookie,
  setCookieTestCookie,
  setHasEmailCookie,
  setParentReferrerCookie,
  setParentUrlCookie,
  setPermanentCookie,
  setTokenCookie,
  setUidCookie,
  setUserCreatedTimestampCookie
};
