import { asyncMiddleware } from '../middlewares/utilityMiddleware.js';
import { authenticateUser } from '../services/auth/authService.js';
import * as sessionService from '../services/auth/sessionService.js';
import logger from '../utils/logger.js';

/**
 * Middleware to authenticate requests (required authentication)
 * @param {Function} assigner - Function to assign the user ID to the request
 * @returns {Function} - Express middleware function
 */
function auth(assigner) {
  return _auth(assigner, false);
}

/**
 * Middleware to authenticate requests (optional authentication)
 * @param {Function} assigner - Function to assign the user ID to the request
 * @returns {Function} - Express middleware function
 */
function authOptional(assigner) {
  return _auth(assigner, true);
}

/**
 * Internal authentication middleware function
 * @param {Function} assigner - Function to assign properties to the request
 * @param {boolean} isOptional - Whether authentication is optional
 * @returns {Function} - Express middleware function
 */
function _auth(assigner, isOptional) {
  return asyncMiddleware(async (req, res, next) => {
    try {
      // Get authentication result
      const authResult = await authenticateUser(req, res);

      // If authenticated, assign the user ID to the request
      if (authResult?.uid) {
        if (assigner) {
          assigner(req, 'uid', authResult.uid);

          // If XID is present, assign it to the request
          if (authResult.xid) {
            assigner(req, 'xid', authResult.xid);
          }
        }

        // Also set req.p.uid for backward compatibility
        req.p = req.p || {};
        req.p.uid = authResult.uid;

        // If this was an auth that requires cookies to be added
        if (authResult.shouldAddCookies) {
          try {
            await sessionService.startSessionAndAddCookies(authResult.uid, res);
          } catch (sessionErr) {
            res.status(500);
            logger.error('polis_err_auth_token_error_2343', sessionErr);
            return next('polis_err_auth_token_error_2343');
          }
        }

        return next();
      }

      // If there's a specific error in the authentication result, handle it
      if (authResult?.error) {
        // Use status code from result if provided
        if (authResult.status) {
          res.status(authResult.status);
        }
        return next(authResult.error);
      }

      // If authentication is optional, continue
      if (isOptional) {
        return next();
      }

      // Authentication is required but failed
      // IMPORTANT: Legacy behavior used status 500 for auth token not supplied errors
      // This is not RESTful but needed for test compatibility
      res.status(500);
      return next('polis_err_auth_token_not_supplied');
    } catch (err) {
      // IMPORTANT: In the legacy code, the doAuth().catch() would always set status 500
      // This overrides any previous status that might have been set
      res.status(500);
      logger.error('polis_err_auth_error_432', err);
      return next(err || 'polis_err_auth_error_432');
    }
  });
}

export { auth, authOptional };
