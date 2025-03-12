import * as pg from '../db/pg-query.js';
import { startSessionAndAddCookies } from '../services/auth/sessionService.js';
import * as tokenService from '../services/auth/tokenService.js';
import { markUserAsVerified } from '../services/user/userService.js';
import logger from '../utils/logger.js';
import { fail } from '../utils/responseHandlers.js';

const pgQueryP = pg.queryP;

/**
 * Handle email verification
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function verifyEmail(req, res) {
  try {
    const { token } = req.p;

    // Get user ID for token
    const uid = await tokenService.getUserIdForVerificationToken(token);

    if (!uid) {
      return fail(res, 400, 'polis_err_verification_invalid_token');
    }

    // Mark user as verified
    await markUserAsVerified(uid);

    // Clear verification token
    await tokenService.clearVerificationToken(token);

    // Start session and add cookies
    await startSessionAndAddCookies(uid, res);

    // Redirect to home page
    res.redirect('/');
  } catch (error) {
    logger.error('Error in verifyEmail controller', error);
    fail(res, 500, 'polis_err_verification');
  }
}

/**
 * Handle GET request to verify an email address
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
function handleGetVerification(req, res) {
  const einvite = req.p.e;
  pgQueryP('select * from einvites where einvite = ($1);', [einvite])
    .then((rows) => {
      if (!rows.length) {
        fail(res, 500, 'polis_err_verification_missing');
      }
      const email = rows[0].email;
      return pgQueryP('select email from email_validations where email = ($1);', [email]).then((rows) => {
        if (rows && rows.length > 0) {
          return true;
        }
        return pgQueryP('insert into email_validations (email) values ($1);', [email]);
      });
    })
    .then(() => {
      res.set('Content-Type', 'text/html');
      res.send(`<html><body>
<div style='font-family: Futura, Helvetica, sans-serif;'>
Email verified! You can close this tab or hit the back button.
</div>
</body></html>`);
    })
    .catch((err) => {
      fail(res, 500, 'polis_err_verification', err);
    });
}

export { verifyEmail, handleGetVerification };
