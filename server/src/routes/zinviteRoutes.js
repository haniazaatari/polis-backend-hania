import express from 'express';
import { handleGetZinvites, handlePostZinvites } from '../controllers/zinviteController.js';
import { auth, moveToBody } from '../middlewares/index.js';
import { assignToP, assignToPCustom, getBool, getConversationIdFetchZid, need, want } from '../utils/parameter.js';

const router = express();

/**
 * @route GET /api/v3/zinvites/:zid
 * @desc Get all zinvites for a conversation
 * @access Private
 */
router.get(
  '/:zid',
  moveToBody,
  auth(assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  handleGetZinvites
);

/**
 * @route POST /api/v3/zinvites/:zid
 * @desc Create a new zinvite for a conversation
 * @access Private
 */
router.post(
  '/:zid',
  moveToBody,
  auth(assignToP),
  want('short_url', getBool, assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  handlePostZinvites
);

export default router;
