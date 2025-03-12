import { COOKIES } from '../services/auth/constants.js';
import * as cookieService from '../services/auth/cookieService.js';
import { generateSessionToken } from '../services/auth/sessionService.js';
import { hexToStr } from '../utils/common.js';

/**
 * Handle GET request for launch preparation
 * Sets necessary cookies and redirects to the destination
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const handleLaunchPrep = (req, res) => {
  // Set permanent cookie if not present
  if (!req.cookies[COOKIES.PERMANENT_COOKIE]) {
    cookieService.setPermanentCookie(req, res, generateSessionToken());
  }

  // Set test cookie
  cookieService.setCookieTestCookie(req, res);

  // Set top cookie
  cookieService.setCookie(req, res, 'top', 'ok', {
    httpOnly: false
  });

  // Redirect to destination
  const dest = hexToStr(req.p.dest);
  const url = new URL(dest);
  res.redirect(url.pathname + url.search + url.hash);
};
