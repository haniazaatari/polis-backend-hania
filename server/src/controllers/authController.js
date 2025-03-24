import { storePasswordHash } from '../repositories/auth/authRepository.js';
import { createUser, getUserByEmail } from '../repositories/user/userRepository.js';
import { authenticateWithCredentials } from '../services/auth/authService.js';
import { COOKIES } from '../services/auth/constants.js';
import { addCookies, clearCookies } from '../services/auth/cookieService.js';
import { generateHashedPassword } from '../services/auth/passwordService.js';
import { createSession, endSession, startSessionAndAddCookies } from '../services/auth/sessionService.js';
import { resetPassword as resetUserPassword } from '../services/user/userService.js';
import { decodeParams } from '../services/utils/encodingService.js';
import logger from '../utils/logger.js';
import { fail } from '../utils/responseHandlers.js';

/**
 * Handle user login
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function login(req, res) {
  try {
    const { email, password } = req.p;

    // Get user by email first to log the UID
    const user = await getUserByEmail(email);
    if (!user) {
      // Return 403 for missing email to match legacy server
      return fail(res, 403, 'polis_err_login_unknown_user_or_password_noresults');
    }

    // Authenticate user
    const result = await authenticateWithCredentials(email, password);

    if (result.success || result.isAuthenticated) {
      // Start session and add cookies - pass req to ensure all cookies are set
      const token = await startSessionAndAddCookies(result.uid, res, req);

      // Return user info
      res.status(200).json({
        uid: result.uid,
        email: result.email,
        hname: result.hname
      });
    } else {
      fail(res, 401, 'polis_err_login_invalid_credentials');
    }
  } catch (error) {
    logger.error('Error in login controller', error);
    fail(res, 500, 'polis_err_login');
  }
}

/**
 * Handle user registration
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function register(req, res) {
  try {
    const { email, password, password2, hname, zinvite, oinvite, gatekeeperTosPrivacy, encodedParams } = req.p;

    // Input validation
    if (password2 && password !== password2) {
      return fail(res, 400, 'Passwords do not match.');
    }

    if (!gatekeeperTosPrivacy) {
      return fail(res, 400, 'polis_err_reg_need_tos');
    }

    if (!email) {
      return fail(res, 400, 'polis_err_reg_need_email');
    }

    if (!hname) {
      return fail(res, 400, 'polis_err_reg_need_name');
    }

    if (!password) {
      return fail(res, 400, 'polis_err_reg_password');
    }

    if (password.length < 6) {
      return fail(res, 400, 'polis_err_reg_password_too_short');
    }

    if (!email.includes('@') || email.length < 3) {
      return fail(res, 400, 'polis_err_reg_bad_email');
    }

    // Parse site_id from encoded params
    let site_id;
    if (encodedParams) {
      try {
        const decodedParams = decodeParams(encodedParams);
        site_id = decodedParams.site_id;
      } catch (_err) {
        return fail(res, 400, 'polis_err_invalid_params');
      }
    }

    // Check if email exists
    const existingUser = await getUserByEmail(email);
    if (existingUser) {
      return fail(res, 403, 'polis_err_reg_user_with_that_email_exists');
    }

    // Create user first
    const user = await createUser({
      email,
      hname,
      zinvite,
      oinvite,
      site_id
    });
    logger.debug('User record created:', { uid: user.uid });

    // Generate and store password hash
    const hashedPassword = await generateHashedPassword(password);
    await storePasswordHash(user.uid, hashedPassword);

    // Start session and add cookies - use addCookies to set all cookies
    const token = await createSession(user.uid);
    await addCookies(req, res, token, user.uid);

    // Also set x-polis header to match legacy behavior
    res.header('x-polis', token);

    // Return success
    res.json({
      uid: user.uid,
      hname: user.hname,
      email: user.email
    });
  } catch (error) {
    logger.error('Error in register:', {
      error: error.message,
      stack: error.stack,
      body: req.body,
      p: req.p
    });
    fail(res, 500, 'polis_err_register');
  }
}

/**
 * Handle password reset
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function resetPassword(req, res) {
  try {
    const { token, password } = req.p;

    // Reset password
    const result = await resetUserPassword(token, password);

    if (result.success) {
      // Start session and add cookies - pass req to ensure all cookies are set
      await startSessionAndAddCookies(result.uid, res, req);

      res.status(200).json({ success: true });
    } else {
      fail(res, 400, result.error);
    }
  } catch (error) {
    logger.error('Error in resetPassword controller', error);
    fail(res, 500, 'polis_err_reset_password');
  }
}

/**
 * Handle user deregistration (logout)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function deregister(req, res) {
  try {
    const token = req.cookies[COOKIES.TOKEN];

    // Validate req.p exists before using it
    if (!req.p) {
      logger.error('req.p is undefined in deregister');
      return fail(res, 500, 'parameter middleware failed');
    }

    // Clear cookies first
    clearCookies(req, res);

    // If no token, handle based on showPage
    if (!token) {
      if (!req.p.showPage) {
        return res.status(200).end();
      }
      // If showPage is set but no token, return 401
      return res.status(401).json({ error: 'polis_err_auth_token_not_supplied' });
    }

    try {
      // End the session
      await endSession(token);
    } catch (sessionError) {
      logger.error('Failed to end session:', sessionError);
      return fail(res, 500, "couldn't end session", sessionError);
    }

    // Return success if no showPage
    if (!req.p.showPage) {
      res.status(200).end();
    } else {
      // If showPage is set, return 200 since we successfully logged out
      res.status(200).end();
    }
  } catch (error) {
    logger.error('Error in deregister controller:', error);
    fail(res, 500, "couldn't end session", error);
  }
}

export { login, register, resetPassword, deregister };
