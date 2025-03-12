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

    // Authenticate user
    const result = await authenticateWithCredentials(email, password);

    if (result.success) {
      // Start session and add cookies
      await startSessionAndAddCookies(result.uid, res);

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
    logger.debug('Registration request.p:', req.p);
    logger.debug('Registration request body:', req.body);

    const { email, password, password2, hname, zinvite, oinvite, gatekeeperTosPrivacy, encodedParams } = req.p;

    // Log all inputs
    logger.debug('Registration inputs:', {
      hasEmail: !!email,
      hasPassword: !!password,
      hasHname: !!hname,
      hasGatekeeper: !!gatekeeperTosPrivacy
    });

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
    logger.debug('Creating user record...');
    const user = await createUser({
      email,
      hname,
      zinvite,
      oinvite,
      site_id
    });
    logger.debug('User record created:', { uid: user.uid });

    // Generate and store password hash
    logger.debug('Generating password hash...');
    const hashedPassword = await generateHashedPassword(password);
    logger.debug('Storing password hash...');
    await storePasswordHash(user.uid, hashedPassword);
    logger.debug('Password hash stored');

    // Start session
    logger.debug('Creating session...');
    const token = await createSession(user.uid);
    logger.debug('Session created');

    // Add cookies
    logger.debug('Adding cookies...');
    await addCookies(req, res, token, user.uid);
    logger.debug('Cookies added');

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
      // Start session and add cookies
      await startSessionAndAddCookies(result.uid, res);

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

    // Clear cookies
    clearCookies(req, res);

    // If no token, just return success
    if (!token) {
      if (!req.p.showPage) {
        return res.status(200).end();
      }
      return;
    }

    // End the session
    await endSession(token);

    // Return success
    if (!req.p.showPage) {
      res.status(200).end();
    }
  } catch (error) {
    logger.error('Error in deregister controller', error);
    fail(res, 500, "couldn't end session", error);
  }
}

export { login, register, resetPassword, deregister };
