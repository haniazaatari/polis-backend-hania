import LruCache from 'lru-cache';
import _ from 'underscore';
import { isUri } from 'valid-url';
import { getRidFromReportId } from '../db/reports.js';
import { getZidFromConversationId } from '../services/conversation/conversationService.js';
import logger from './logger.js';

/**
 * Extract a parameter value from the request body only.
 * This matches legacy behavior where parameters are only pulled from body.
 * @param {Object} req - Express request object
 * @param {string} name - Parameter name
 * @returns {*} Parameter value or undefined
 */
function extractFromBody(req, name) {
  if (!req.body) {
    return void 0;
  }
  return req.body[name];
}

/**
 * Require a parameter to be present in the request body.
 * NOTE: Unlike a more modern implementation that might check req.query and req.params,
 * this legacy-compatible version only checks req.body. This is why the moveToBody
 * middleware is required for GET requests in the legacy codebase.
 */
function need(name, parserWhichReturnsPromise, assigner) {
  return async (req, res, next) => {
    const val = extractFromBody(req, name);
    if (_.isUndefined(val) || _.isNull(val)) {
      const errorString = `polis_err_param_missing_${name}`;
      logger.error(errorString);
      res.status(400);
      return next(errorString);
    }

    try {
      const parsed = await parserWhichReturnsPromise(val);
      assigner(req, name, parsed);
      next();
    } catch (err) {
      res.status(400);
      next(`polis_err_param_parse_failed_${name}: ${err}`);
    }
  };
}

/**
 * Optionally accept a parameter from the request body.
 * Like need(), this only checks req.body to match legacy behavior.
 */
function want(name, parserWhichReturnsPromise, assigner, defaultVal) {
  return async (req, res, next) => {
    const val = extractFromBody(req, name);
    if (!_.isUndefined(val) && !_.isNull(val)) {
      try {
        const parsed = await parserWhichReturnsPromise(val);
        assigner(req, name, parsed);
        return next();
      } catch (err) {
        res.status(400);
        return next(`polis_err_param_parse_failed_${name}: ${err}`);
      }
    }
    if (!_.isUndefined(defaultVal)) {
      assigner(req, name, defaultVal);
    }
    next();
  };
}

function wantCookie(name, parserWhichReturnsPromise, assigner, defaultVal) {
  return buildCallback({
    name: name,
    extractor: extractFromCookie,
    parserWhichReturnsPromise: parserWhichReturnsPromise,
    assigner: assigner,
    required: false,
    defaultVal: defaultVal
  });
}

function wantHeader(name, parserWhichReturnsPromise, assigner, defaultVal) {
  return buildCallback({
    name: name,
    extractor: extractFromHeader,
    parserWhichReturnsPromise: parserWhichReturnsPromise,
    assigner: assigner,
    required: false,
    defaultVal: defaultVal
  });
}

function extractFromCookie(req, name) {
  if (!req.cookies) {
    return void 0;
  }
  return req.cookies[name];
}

function extractFromHeader(req, name) {
  if (!req.headers) {
    return void 0;
  }
  return req.headers[name.toLowerCase()];
}

function buildCallback(config) {
  const name = config.name;
  const parserWhichReturnsPromise = config.parserWhichReturnsPromise;
  const assigner = config.assigner;
  const required = config.required;
  const defaultVal = config.defaultVal;
  const extractor = config.extractor;

  if (typeof assigner !== 'function') {
    throw new Error('bad arg for assigner');
  }
  if (typeof parserWhichReturnsPromise !== 'function') {
    throw new Error('bad arg for parserWhichReturnsPromise');
  }

  return async (req, res, next) => {
    const val = extractor(req, name);

    // Initialize req.p if it doesn't exist
    req.p = req.p || {};

    // Handle explicit null values for non-required parameters
    if (val === null && !required) {
      logger.debug(`Setting null value for ${name}`);
      assigner(req, name, null);
      return next();
    }

    if (!_.isUndefined(val) && !_.isNull(val)) {
      try {
        const parsed = await parserWhichReturnsPromise(val);
        assigner(req, name, parsed);
        next();
      } catch (err) {
        const s = `polis_err_param_parse_failed_${name} (val='${val}', error=${err})`;
        logger.error(s, err);
        res.status(400);
        next(s);
      }
    } else if (!required) {
      if (typeof defaultVal !== 'undefined') {
        assigner(req, name, defaultVal);
      } else {
        // For non-required parameters with no default, explicitly set undefined
        assigner(req, name, undefined);
      }
      next();
    } else {
      const s = `polis_err_param_missing_${name}`;
      logger.error(s);
      res.status(400);
      next(s);
    }
  };
}

function isEmail(s) {
  return typeof s === 'string' && s.length < 999 && s.indexOf('@') > 0;
}

function getEmail(s) {
  return new Promise((resolve, reject) => {
    if (!isEmail(s)) {
      return reject('polis_fail_parse_email');
    }
    resolve(s);
  });
}

function getPassword(s) {
  return new Promise((resolve, reject) => {
    if (typeof s !== 'string' || s.length > 999 || s.length === 0) {
      return reject('polis_fail_parse_password');
    }
    resolve(s);
  });
}

async function getPasswordWithCreatePasswordRules(s) {
  const validatedPassword = await getPassword(s);
  if (typeof validatedPassword !== 'string' || validatedPassword.length < 6) {
    throw new Error('polis_err_password_too_short');
  }
  return validatedPassword;
}

function getOptionalStringLimitLength(limit) {
  return (s) =>
    new Promise((resolve, reject) => {
      if (s.length && s.length > limit) {
        return reject('polis_fail_parse_string_too_long');
      }
      const trimmedS = s.replace(/^ */, '').replace(/ *$/, '');
      resolve(trimmedS);
    });
}

function getStringLimitLength(minLength, maxLength) {
  const effectiveMin = _.isUndefined(maxLength) ? 1 : minLength;
  const effectiveMax = _.isUndefined(maxLength) ? minLength : maxLength;

  return (s) =>
    new Promise((resolve, reject) => {
      if (typeof s !== 'string') {
        return reject('polis_fail_parse_string_missing');
      }
      if (s.length && s.length > effectiveMax) {
        return reject('polis_fail_parse_string_too_long');
      }
      if (s.length && s.length < effectiveMin) {
        return reject('polis_fail_parse_string_too_short');
      }
      const trimmedS = s.replace(/^ */, '').replace(/ *$/, '');
      resolve(trimmedS);
    });
}

function getUrlLimitLength(limit) {
  return async (s) => {
    const validatedString = await getStringLimitLength(limit)(s);
    if (isUri(validatedString)) {
      return validatedString;
    }
    throw new Error('polis_fail_parse_url_invalid');
  };
}

function getInt(s) {
  return new Promise((resolve, reject) => {
    if (_.isNumber(s) && s >> 0 === s) {
      return resolve(s);
    }
    const x = Number.parseInt(s);
    if (Number.isNaN(x)) {
      return reject(`polis_fail_parse_int ${s}`);
    }
    resolve(x);
  });
}

function getBool(s) {
  return new Promise((resolve, reject) => {
    const type = typeof s;
    if ('boolean' === type) {
      return resolve(s);
    }
    if ('number' === type) {
      if (s === 0) {
        return resolve(false);
      }
      return resolve(true);
    }
    const lowerS = s.toLowerCase();
    if (lowerS === 't' || lowerS === 'true' || lowerS === 'on' || lowerS === '1') {
      return resolve(true);
    }
    if (lowerS === 'f' || lowerS === 'false' || lowerS === 'off' || lowerS === '0') {
      return resolve(false);
    }
    reject('polis_fail_parse_boolean');
  });
}

function getIntInRange(min, max) {
  return async (s) => {
    const x = await getInt(s);
    if (x < min || max < x) {
      throw new Error('polis_fail_parse_int_out_of_range');
    }
    return x;
  };
}

const reportIdToRidCache = new LruCache({
  max: 1000
});

/**
 * Get report ID with caching
 * @param {string} report_id - Report ID to look up
 * @returns {Promise<number>} - The numeric report ID
 */
async function getRidFromReportIdWithCache(report_id) {
  const cachedRid = reportIdToRidCache.get(report_id);
  if (cachedRid) {
    return cachedRid;
  }

  const rid = await getRidFromReportId(report_id);
  if (!rid) {
    throw new Error('polis_err_fetching_rid_for_report_id');
  }

  reportIdToRidCache.set(report_id, rid);
  return rid;
}

const parseConversationId = getStringLimitLength(1, 100);

async function getConversationIdFetchZid(s) {
  const conversation_id = await parseConversationId(s);
  const zid = await getZidFromConversationId(conversation_id);
  return Number(zid);
}

const parseReportId = getStringLimitLength(1, 100);

async function getReportIdFetchRid(s) {
  const report_id = await parseReportId(s);
  const rid = await getRidFromReportIdWithCache(report_id);
  return Number(rid);
}

function getNumber(s) {
  return new Promise((resolve, reject) => {
    if (_.isNumber(s)) {
      return resolve(s);
    }
    const x = Number.parseFloat(s);
    if (Number.isNaN(x)) {
      return reject('polis_fail_parse_number');
    }
    resolve(x);
  });
}

function getNumberInRange(min, max) {
  return async (s) => {
    const x = await getNumber(s);
    if (x < min || max < x) {
      throw new Error('polis_fail_parse_number_out_of_range');
    }
    return x;
  };
}

function getArrayOfString(a, _maxStrings, _maxLength) {
  return new Promise((resolve, reject) => {
    let result;
    if (_.isString(a)) {
      result = a.split(',');
    }
    if (!Array.isArray(result)) {
      return reject('polis_fail_parse_int_array');
    }
    resolve(result);
  });
}

function getArrayOfStringNonEmpty(a, _maxStrings, _maxLength) {
  if (!a || !a.length) {
    return Promise.reject('polis_fail_parse_string_array_empty');
  }
  return getArrayOfString(a);
}

function getArrayOfStringNonEmptyLimitLength(maxStrings, maxLength) {
  const effectiveMaxStrings = maxStrings || 999999999;
  return (a) => getArrayOfStringNonEmpty(a, effectiveMaxStrings, maxLength);
}

function getArrayOfInt(a) {
  const arrayToProcess = _.isString(a) ? a.split(',') : a;

  if (!Array.isArray(arrayToProcess)) {
    return Promise.reject('polis_fail_parse_int_array');
  }

  function integer(i) {
    return Number(i) >> 0;
  }

  return Promise.resolve(arrayToProcess.map(integer));
}

function assignToP(req, name, x) {
  req.p = req.p || {};
  if (!_.isUndefined(req.p[name])) {
    logger.error(`polis_err_clobbering ${name}`);
  }
  req.p[name] = x;
}

function assignToPCustom(name) {
  return (req, _ignoredName, x) => {
    assignToP(req, name, x);
  };
}

/**
 * Convert params object to a sorted string for HMAC generation
 * @param {Object} params - The parameters to convert
 * @returns {string} - The sorted string representation
 */
function paramsToStringSortedByName(params) {
  const pairs = _.pairs(params).sort((a, b) => a[0] > b[0]);
  const pairsList = pairs.map((pair) => pair.join('='));
  return pairsList.join('&');
}

// Export functions for use in other modules
export {
  assignToP,
  assignToPCustom,
  extractFromBody,
  extractFromCookie,
  getArrayOfInt,
  getArrayOfStringNonEmpty,
  getArrayOfStringNonEmptyLimitLength,
  getBool,
  getConversationIdFetchZid,
  getEmail,
  getInt,
  getIntInRange,
  getNumberInRange,
  getOptionalStringLimitLength,
  getPassword,
  getPasswordWithCreatePasswordRules,
  getReportIdFetchRid,
  getStringLimitLength,
  getUrlLimitLength,
  need,
  paramsToStringSortedByName,
  want,
  wantCookie,
  wantHeader
};
