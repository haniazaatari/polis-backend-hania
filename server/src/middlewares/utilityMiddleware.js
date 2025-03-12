import logger from '../utils/logger.js';

/**
 * Converts an async function to an Express 3.x compatible middleware
 * @param {Function} asyncFn - The async function to convert
 * @returns {Function} - Express 3.x compatible middleware
 */
export function asyncMiddleware(asyncFn) {
  return (req, res, next) => {
    Promise.resolve(asyncFn(req, res, next)).catch((err) => {
      // Log the error to the server logs
      logger.error('Async middleware error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    });
  };
}
