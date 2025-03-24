import express from 'express';
import { handlePostStars } from '../controllers/starController.js';
import { auth, getPidForParticipant } from '../middlewares/index.js';
import { pidCache } from '../repositories/participant/participantRepository.js';
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
 * @route POST /api/v3/stars
 * @desc Star or unstar a comment
 * @access Private
 */
router.post(
  '/',
  auth(assignToP),
  need('tid', getInt, assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  need('starred', getIntInRange(0, 1), assignToP),
  getPidForParticipant(assignToP, pidCache),
  handlePostStars
);

export default router;
