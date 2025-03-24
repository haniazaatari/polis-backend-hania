import express from 'express';
import { handlePostTrashes } from '../controllers/trashController.js';
import { pidCache } from '../db/participants.js';
import { auth, getPidForParticipant } from '../middlewares/index.js';
import {
  assignToP,
  assignToPCustom,
  getConversationIdFetchZid,
  getInt,
  getIntInRange,
  need
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
  need('tid', getInt, assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  need('trashed', getIntInRange(0, 1), assignToP),
  getPidForParticipant(assignToP, pidCache),
  handlePostTrashes
);

export default router;
