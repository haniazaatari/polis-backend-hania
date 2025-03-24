import { getPermanentCookieAndEnsureItIsSet } from '../services/auth/cookieService.js';
/**
 * Participation Controller
 * Handles HTTP requests related to participation
 */
import { getParticipation, getParticipationInit } from '../services/participation/participationService.js';
import logger from '../utils/logger.js';
import { fail } from '../utils/responseHandlers.js';

/**
 * Handle GET request for participation data
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleGetParticipation(req, res) {
  try {
    const zid = req.p.zid;
    const uid = req.p.uid;
    const strict = req.p.strict;

    const result = await getParticipation(zid, uid, strict);
    res.status(200).json(result);
  } catch (err) {
    if (err.message === 'polis_err_get_participation_auth') {
      fail(res, 403, err.message);
    } else if (err.message?.includes('polis_err_get_participation_missing_xids')) {
      fail(res, 409, err.message);
    } else {
      logger.error('Error in handleGetParticipation', { error: err });
      fail(res, 500, 'polis_err_get_participation_misc', err);
    }
  }
}

/**
 * Handle GET request for participation initialization data
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleGetParticipationInit(req, res) {
  try {
    logger.info('handleGetParticipationInit', req.p);

    // Get accept-language header
    const acceptLanguage = req?.headers?.['accept-language'] || req?.headers?.['Accept-Language'] || 'en-US';

    // Set language based on acceptLanguage if requested
    if (req.p.lang === 'acceptLang') {
      req.p.lang = acceptLanguage.substr(0, 2);
    }

    // Ensure permanent cookie is set
    getPermanentCookieAndEnsureItIsSet(req, res);

    // Prepare parameters for the service
    const params = {
      ...req.p,
      acceptLanguage
    };

    logger.debug('Calling getParticipationInit with params:', params);

    try {
      // Get participation initialization data
      const result = await getParticipationInit(params);
      res.status(200).json(result);
    } catch (err) {
      logger.error('Error in getParticipationInit service call', {
        error: err,
        message: err.message,
        stack: err.stack,
        params: JSON.stringify(params, null, 2)
      });

      // Provide more specific error handling
      if (err.message?.includes('unexpected db query syntax')) {
        fail(res, 500, 'polis_err_db_query_syntax', 'Database query syntax error');
      } else {
        fail(res, 500, 'polis_err_get_participationInit', err);
      }
    }
  } catch (err) {
    logger.error('Error in handleGetParticipationInit', {
      error: err,
      message: err.message,
      stack: err.stack,
      params: JSON.stringify(req.p, null, 2)
    });
    fail(res, 500, 'polis_err_get_participationInit', err);
  }
}

export { handleGetParticipation, handleGetParticipationInit };
