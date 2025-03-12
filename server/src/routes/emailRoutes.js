import express from 'express';
import { handleGetEinvites, handlePostEinvites } from '../controllers/einviteController.js';
import {
  handleNotifyTeam,
  handleSendCreatedLinkToEmail,
  handleSendEmailExportReady
} from '../controllers/emailController.js';
import { handleNotificationsSubscribe, handleNotificationsUnsubscribe } from '../controllers/notificationController.js';
import { handleGetVerification } from '../controllers/verificationController.js';
import { auth, moveToBody } from '../middlewares/index.js';
import { HMAC_SIGNATURE_PARAM_NAME } from '../utils/hmac.js';
import {
  assignToP,
  assignToPCustom,
  getConversationIdFetchZid,
  getEmail,
  getStringLimitLength,
  need
} from '../utils/parameter.js';

const router = express();

// Email routes
router.post(
  '/sendCreatedLinkToEmail',
  auth(assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  handleSendCreatedLinkToEmail
);

router.post(
  '/sendEmailExportReady',
  need('webserver_username', getStringLimitLength(1, 999), assignToP),
  need('webserver_pass', getStringLimitLength(1, 999), assignToP),
  need('email', getEmail, assignToP),
  need('conversation_id', getStringLimitLength(1, 1000), assignToP),
  need('filename', getStringLimitLength(9999), assignToP),
  handleSendEmailExportReady
);

router.post(
  '/notifyTeam',
  need('webserver_username', getStringLimitLength(1, 999), assignToP),
  need('webserver_pass', getStringLimitLength(1, 999), assignToP),
  need('subject', getStringLimitLength(9999), assignToP),
  need('body', getStringLimitLength(99999), assignToP),
  handleNotifyTeam
);

// Notification routes
router.get(
  '/notifications/subscribe',
  moveToBody,
  need(HMAC_SIGNATURE_PARAM_NAME, getStringLimitLength(10, 999), assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  need('conversation_id', getStringLimitLength(1, 1000), assignToP),
  need('email', getEmail, assignToP),
  handleNotificationsSubscribe
);

router.get(
  '/notifications/unsubscribe',
  moveToBody,
  need(HMAC_SIGNATURE_PARAM_NAME, getStringLimitLength(10, 999), assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  need('conversation_id', getStringLimitLength(1, 1000), assignToP),
  need('email', getEmail, assignToP),
  handleNotificationsUnsubscribe
);

// Verification routes
/**
 * @route GET /api/v3/verify
 * @desc Verify a user's email
 * @access Public
 */
router.get('/verify', moveToBody, need('email', getStringLimitLength(1, 1000), assignToP), handleGetVerification);

// Einvite routes
router.post('/einvites', need('email', getEmail, assignToP), handlePostEinvites);

router.get('/einvites', moveToBody, need('einvite', getStringLimitLength(1, 100), assignToP), handleGetEinvites);

export default router;
