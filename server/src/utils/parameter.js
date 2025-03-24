import LruCache from 'lru-cache';
import _ from 'underscore';
import { isUri } from 'valid-url';
import * as pg from '../db/pg-query.js';
import { getZidFromConversationId } from '../services/conversation/conversationService.js';
import logger from './logger.js';
import { MPromise } from './metered.js';
import { fail } from './responseHandlers.js';

function need(name, parserWhichReturnsPromise, assigner) {
  return (req, res, next) => {
    const bodyHasParam = req.body && !_.isUndefined(req.body[name]);
    const queryHasParam = req.query && !_.isUndefined(req.query[name]);
    const paramsHasParam = req.params && !_.isUndefined(req.params[name]);
    if (!bodyHasParam && !queryHasParam && !paramsHasParam) {
      // Return specific error codes for known parameters to match legacy server
      if (name === 'password') {
        fail(res, 400, 'polis_err_param_missing_password');
      } else if (name === 'email') {
        fail(res, 400, 'polis_err_param_missing_email');
      } else {
        fail(res, 400, 'polis_err_param_missing', { param: name });
      }
      return;
    }
    const paramValue = bodyHasParam ? req.body[name] : queryHasParam ? req.query[name] : req.params[name];
    return parserWhichReturnsPromise(paramValue)
      .then((parsed) => {
        assigner(req, name, parsed);
        next();
      })
      .catch((err) => {
        fail(res, 400, 'polis_err_param_parse_failed', { param: name, err: err });
      });
  };
}

function want(name, parserWhichReturnsPromise, assigner, defaultVal) {
  return buildCallback({
    name: name,
    extractor: extractFromBody,
    parserWhichReturnsPromise: parserWhichReturnsPromise,
    assigner: assigner,
    required: false,
    defaultVal: defaultVal
  });
}

function needCookie(name, parserWhichReturnsPromise, assigner) {
  return buildCallback({
    name: name,
    extractor: extractFromCookie,
    parserWhichReturnsPromise: parserWhichReturnsPromise,
    assigner: assigner,
    required: true
  });
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

function extractFromBody(req, name) {
  if (!req.body) {
    return void 0;
  }
  return req.body[name];
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

  return (req, res, next) => {
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
      parserWhichReturnsPromise(val)
        .then(
          (parsed) => {
            assigner(req, name, parsed);
            next();
          },
          (err) => {
            const s = `polis_err_param_parse_failed_${name} (val='${val}', error=${err})`;
            logger.error(s, err);
            res.status(400);
            next(s);
            return;
          }
        )
        .catch((err) => {
          logger.error(`Unexpected error parsing ${name}:`, err);
          fail(res, 400, 'polis_err_misc', err);
          return;
        });
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

function getPasswordWithCreatePasswordRules(s) {
  return getPassword(s).then((s) => {
    if (typeof s !== 'string' || s.length < 6) {
      throw new Error('polis_err_password_too_short');
    }
    return s;
  });
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
  return (s) => {
    getStringLimitLength(limit)(s).then(
      (s) =>
        new Promise((resolve, reject) => {
          if (isUri(s)) {
            return resolve(s);
          }

          return reject('polis_fail_parse_url_invalid');
        })
    );
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
  return (s) =>
    getInt(s).then((x) => {
      if (x < min || max < x) {
        throw new Error('polis_fail_parse_int_out_of_range');
      }
      return x;
    });
}

const reportIdToRidCache = new LruCache({
  max: 1000
});

function getRidFromReportId(report_id) {
  return MPromise('getRidFromReportId', (resolve, reject) => {
    const cachedRid = reportIdToRidCache.get(report_id);
    if (cachedRid) {
      resolve(cachedRid);
      return;
    }
    pg.query_readOnly('select rid from reports where report_id = ($1);', [report_id], (err, results) => {
      if (err) {
        logger.error(`polis_err_fetching_rid_for_report_id ${report_id}`, err);
        return reject(err);
      }
      if (!results || !results.rows || !results.rows.length) {
        return reject('polis_err_fetching_rid_for_report_id');
      }

      const rid = results.rows[0].rid;
      reportIdToRidCache.set(report_id, rid);
      return resolve(rid);
    });
  });
}

const parseConversationId = getStringLimitLength(1, 100);

function getConversationIdFetchZid(s) {
  return parseConversationId(s).then((conversation_id) =>
    getZidFromConversationId(conversation_id).then((zid) => Number(zid))
  );
}

const parseReportId = getStringLimitLength(1, 100);

function getReportIdFetchRid(s) {
  return parseReportId(s).then((report_id) => getRidFromReportId(report_id).then((rid) => Number(rid)));
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
  return (s) =>
    getNumber(s).then((x) => {
      if (x < min || max < x) {
        throw new Error('polis_fail_parse_number_out_of_range');
      }
      return x;
    });
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
  extractFromHeader,
  getArrayOfInt,
  getArrayOfString,
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
  needCookie,
  paramsToStringSortedByName,
  want,
  wantCookie,
  wantHeader
};
