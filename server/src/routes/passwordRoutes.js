import express from 'express';
import * as passwordController from '../controllers/passwordController.js';
import { moveToBody } from '../middlewares/index.js';
import {
  assignToP,
  getEmail,
  getOptionalStringLimitLength,
  getPasswordWithCreatePasswordRules,
  need
} from '../utils/parameter.js';

const router = express();

/**
 * @api {post} /auth/password Reset password
 * @apiName ResetPassword
 * @apiGroup Auth
 * @apiDescription Reset a user's password using a reset token
 *
 * @apiParam {String} pwresettoken Password reset token
 * @apiParam {String} newPassword New password
 *
 * @apiSuccess {String} message Success message
 * @apiError {String} error Error message
 */
router.post(
  '/password',
  moveToBody,
  need('pwresettoken', getOptionalStringLimitLength(1000), assignToP),
  need('newPassword', getPasswordWithCreatePasswordRules, assignToP),
  passwordController.handlePasswordReset
);

/**
 * @api {post} /auth/pwresettoken Request password reset token
 * @apiName RequestPasswordResetToken
 * @apiGroup Auth
 * @apiDescription Request a password reset token to be sent via email
 *
 * @apiParam {String} email User's email address
 *
 * @apiSuccess {String} message Success message
 * @apiError {String} error Error message
 */
router.post(
  '/pwresettoken',
  moveToBody,
  need('email', getEmail, assignToP),
  passwordController.handlePasswordResetToken
);

export default router;
