import express from 'express';
import * as authController from '../controllers/authController.js';
import {
  assignToP,
  getBool,
  getEmail,
  getOptionalStringLimitLength,
  getPassword,
  getPasswordWithCreatePasswordRules,
  getStringLimitLength,
  need,
  want
} from '../utils/parameter.js';

const router = express();

/**
 * @route POST /api/v3/auth/login
 * @desc Login a user
 * @access Public
 */
router.post(
  '/login',
  need('password', getPassword, assignToP),
  want('email', getEmail, assignToP),
  authController.login
);

/**
 * @route POST /api/v3/auth/new
 * @desc Register a new user
 * @access Public
 */
router.post(
  '/new',
  want('anon', getBool, assignToP),
  want('password', getPasswordWithCreatePasswordRules, assignToP),
  want('password2', getPasswordWithCreatePasswordRules, assignToP),
  want('email', getOptionalStringLimitLength(999), assignToP),
  want('hname', getOptionalStringLimitLength(999), assignToP),
  want('oinvite', getOptionalStringLimitLength(999), assignToP),
  want('encodedParams', getOptionalStringLimitLength(9999), assignToP),
  want('zinvite', getOptionalStringLimitLength(999), assignToP),
  want('organization', getOptionalStringLimitLength(999), assignToP),
  want('gatekeeperTosPrivacy', getBool, assignToP),
  want('owner', getBool, assignToP, true),
  authController.register
);

/**
 * @route POST /api/v3/auth/deregister
 * @desc Logout a user
 * @access Public
 */
router.post('/deregister', want('showPage', getStringLimitLength(1, 99), assignToP), authController.deregister);

export default router;
