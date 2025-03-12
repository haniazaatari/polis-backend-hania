import { COOKIES } from '../services/auth/constants.js';
import { setCookie } from '../services/auth/cookieService.js';
import logger from '../utils/logger.js';

/**
 * Handle try cookie request
 * This endpoint is used to test if cookies can be set and read
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
function handleTryCookie(req, res) {
  try {
    // Check if the try cookie exists
    if (!req.cookies[COOKIES.TRY_COOKIE]) {
      // Set the cookie if it doesn't exist
      setCookie(req, res, COOKIES.TRY_COOKIE, 'ok', {
        httpOnly: false
      });
    }

    // Return an empty JSON response
    res.status(200).json({});
  } catch (error) {
    logger.error('Error handling try cookie request', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export { handleTryCookie };
