import express from 'express';
import {
  handleGetParticipantsOfInterest,
  handleUpdateParticipantModerationStatus
} from '../controllers/participantModerationController.js';
import { auth, authOptional, moveToBody } from '../middlewares/index.js';
import {
  assignToP,
  assignToPCustom,
  getConversationIdFetchZid,
  getInt,
  getStringLimitLength,
  need,
  resolve_pidThing,
  want
} from '../utils/parameter.js';

const router = express();

/**
 * @route GET /api/v3/ptptois
 * @desc Get participants of interest with moderation status
 * @access Public (with optional auth)
 */
router.get(
  '/',
  moveToBody,
  authOptional(assignToP),
  want('mod', getInt, assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  need('conversation_id', getStringLimitLength(1, 1000), assignToP),
  handleGetParticipantsOfInterest
);

/**
 * @route PUT /api/v3/ptptois
 * @desc Update participant moderation status
 * @access Private
 */
router.put(
  '/',
  moveToBody,
  auth(assignToP),
  need('mod', getInt, assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  resolve_pidThing('pid', assignToP),
  handleUpdateParticipantModerationStatus
);

export default router;
