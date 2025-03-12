import logger from '../utils/logger.js';

/**
 * Middleware to redirect users with zid but no conversation_id to the about page
 * This is used to handle legacy requests that use zid directly instead of conversation_id
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 * @returns {void}
 */
export function redirectIfHasZidButNoConversationId(req, res, next) {
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
