import _ from 'underscore';
import { getPidPromise } from '../db/getPidPromise.js';
import { getParticipantId } from '../repositories/participant/participantRepository.js';
import logger from '../utils/logger.js';
import { extractFromBody, extractFromCookie, getInt } from '../utils/parameter.js';
import { fail } from '../utils/responseHandlers.js';
import { asyncMiddleware } from './utilityMiddleware.js';
/**
 * Middleware to resolve participant ID, simplified approach.
 *
 * @param {Function} assigner - Function to assign the resolved ID to the request
 * @param {Object} _cache - Optional cache object
 * @returns {Function} - Express middleware
 */
function getPidForParticipant(assigner, _cache) {
  return (req, _res, next) => {
    const zid = req.p.zid;
    const uid = req.p.uid;
    function finish(pid) {
      assigner(req, 'pid', pid);
      next();
    }
    getPidPromise(zid, uid).then(
      (pid) => {
        if (pid === -1) {
          const msg = 'polis_err_get_pid_for_participant_missing';
          logger.error(msg, {
            zid,
            uid,
            p: req.p
          });
          next(msg);
        }
        finish(pid);
      },
      (err) => {
        logger.error('polis_err_get_pid_for_participant', err);
        next(err);
      }
    );
  };
}

/**
 * Middleware to resolve participant IDs
 * Converts special values like 'mypid' to actual participant IDs
 *
 * @param {string} paramName - The name of the parameter to resolve
 * @param {Function} assigner - Function to assign the resolved ID to the request
 * @param {string} [context] - Optional context for logging
 * @returns {Function} - Express middleware
 */
function resolveParticipantId(paramName, assigner, context) {
  const logContext = context || '';

  return asyncMiddleware(async (req, res, next) => {
    logger.debug(`resolveParticipantId ${logContext}`, req.p);

    // Check if required properties exist
    if (!req.p) {
      fail(res, 500, 'polis_err_this_middleware_should_be_after_auth_and_zid');
      return next('polis_err_this_middleware_should_be_after_auth_and_zid');
    }

    // Get the parameter value from request
    const existingValue = extractFromBody(req, paramName) || extractFromCookie(req, paramName);
    logger.debug(`resolveParticipantId ${logContext} existingValue: ${existingValue}, type: ${typeof existingValue}`);

    // Handle 'mypid' special value
    if (existingValue === 'mypid' && req?.p?.zid && req.p.uid) {
      try {
        const pid = await getParticipantId(req.p.zid, req.p.uid);
        logger.debug(`resolveParticipantId ${logContext} got pid: ${pid}`);

        if (pid >= 0) {
          assigner(req, paramName, pid);
          logger.debug(`resolveParticipantId ${logContext} assigned pid: ${pid}`);
        }
        return next();
      } catch (err) {
        logger.error(`resolveParticipantId ${logContext} error:`, err);
        fail(res, 500, 'polis_err_mypid_resolve_error', err);
        return next(err);
      }
    }
    // Handle 'mypid' without uid or zid
    else if (existingValue === 'mypid') {
      logger.debug(`resolveParticipantId ${logContext} existingValue is mypid but missing uid or zid`);
      return next();
    }
    // Handle numeric values
    else if (!_.isUndefined(existingValue)) {
      try {
        const pidNumber = await getInt(existingValue);
        logger.debug(`resolveParticipantId ${logContext} got pidNumber: ${pidNumber}, type: ${typeof pidNumber}`);

        // Important: pidNumber can be 0, which is a valid pid but falsy in JavaScript
        if (pidNumber >= 0) {
          assigner(req, paramName, pidNumber);
          logger.debug(`resolveParticipantId ${logContext} assigned pidNumber: ${pidNumber}`);
        } else {
          logger.debug(`resolveParticipantId ${logContext} pidNumber < 0: ${pidNumber}`);
        }
        return next();
      } catch (err) {
        logger.error(`resolveParticipantId ${logContext} getInt error:`, err);
        fail(res, 500, 'polis_err_pid_error', err);
        return next(err);
      }
    }
    // No value provided
    else {
      logger.debug(`resolveParticipantId ${logContext} no existing value`);
      return next();
    }
  });
}

export { getPidForParticipant, resolveParticipantId };
