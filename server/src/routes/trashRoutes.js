import express from 'express';
import { handlePostTrashes } from '../controllers/trashController.js';
import { auth } from '../middlewares/index.js';
import {
  assignToP,
  assignToPCustom,
  getBool,
  getConversationIdFetchZid,
  getInt,
  need,
  resolve_pidThing
} from '../utils/parameter.js';

const router = express();

/**
 * @route POST /api/v3/trashes
 * @desc Trash or untrash a comment
 * @access Private
 */
router.post(
  '/',
  auth(assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  need('tid', getInt, assignToP),
  need('trashed', getBool, assignToP),
  resolve_pidThing('pid', assignToP, 'post:trashes'),
  handlePostTrashes
);

export default router;
