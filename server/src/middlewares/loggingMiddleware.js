import _ from 'underscore';
import * as Config from '../config.js';
import logger from '../utils/logger.js';

/**
 * Middleware to log request body (with sensitive information masked)
 * Only logs in development mode
 *
 * @param {Object} req - Express request object
 * @param {Object} _res - Express response object
 * @param {Function} next - Express next function
 */
function logRequestBody(req, _res, next) {
  if (Config.isDevMode) {
    let b = '';
    if (req.body) {
      const temp = _.clone(req.body);
      // Mask sensitive information
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
    logger.debug('logRequestBody', { path: req.path, body: b });
  }
  next();
}

/**
 * Middleware to log middleware errors
 *
 * @param {Error} err - Error object
 * @param {Object} _req - Express request object
 * @param {Object} _res - Express response object
 * @param {Function} next - Express next function
 */
function logMiddlewareErrors(err, _req, _res, next) {
  if (!err) {
    return next();
  }
  logger.error('logMiddlewareErrors', err);
  next(err);
}

export { logRequestBody, logMiddlewareErrors };
