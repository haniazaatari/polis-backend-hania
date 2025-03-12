import express from 'express';
import { handleGetUsers, handlePostUsersInvite, handlePutUsers } from '../controllers/userController.js';
import { auth, authOptional, moveToBody } from '../middlewares/index.js';
import {
  assignToP,
  assignToPCustom,
  getArrayOfStringNonEmpty,
  getBool,
  getConversationIdFetchZid,
  getEmail,
  getInt,
  getOptionalStringLimitLength,
  getStringLimitLength,
  need,
  want
} from '../utils/parameter.js';
const router = express();

/**
 * @route GET /api/v3/users
 * @desc Get a user
 * @access Public (with optional auth)
 */
router.get('/', moveToBody, authOptional(assignToP), want('errIfNoAuth', getBool, assignToP), handleGetUsers);

/**
 * @route PUT /api/v3/users
 * @desc Update a user
 * @access Private
 */
router.put(
  '/',
  moveToBody,
  auth(assignToP),
  want('email', getEmail, assignToP),
  want('hname', getOptionalStringLimitLength(9999), assignToP),
  want('uid_of_user', getInt, assignToP),
  handlePutUsers
);

/**
 * @route POST /api/v3/users/invite
 * @desc Invite users to a conversation
 * @access Private
 */
router.post(
  '/invite',
  auth(assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  need('conversation_id', getStringLimitLength(1, 1000), assignToP),
  need('emails', getArrayOfStringNonEmpty, assignToP),
  handlePostUsersInvite
);

export default router;
