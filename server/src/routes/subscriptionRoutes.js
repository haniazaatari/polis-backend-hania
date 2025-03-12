import express from 'express';
import { handlePostConvSubscriptions } from '../controllers/subscriptionController.js';
import { auth } from '../middlewares/index.js';
import { assignToP, assignToPCustom, getConversationIdFetchZid, getEmail, getInt, need } from '../utils/parameter.js';

const router = express();

/**
 * @route POST /api/v3/convSubscriptions
 * @desc Subscribe or unsubscribe from conversation notifications
 * @access Private
 */
router.post(
  '/',
  auth(assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  need('type', getInt, assignToP),
  need('email', getEmail, assignToP),
  handlePostConvSubscriptions
);

export default router;
