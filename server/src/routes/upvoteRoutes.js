import express from 'express';
import { handlePostUpvotes } from '../controllers/upvoteController.js';
import { auth } from '../middlewares/auth.js';
import { assignToP, assignToPCustom, getConversationIdFetchZid, need } from '../utils/parameter.js';

const router = express();

/**
 * @route POST /api/v3/upvotes
 * @desc Upvote a conversation
 * @access Private
 */
router.post(
  '/',
  auth(assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  handlePostUpvotes
);

export default router;
