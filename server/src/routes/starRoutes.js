import express from 'express';
import { handlePostStars } from '../controllers/starController.js';
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
 * @route POST /api/v3/stars
 * @desc Star or unstar a comment
 * @access Private
 */
router.post(
  '/',
  auth(assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  need('tid', getInt, assignToP),
  need('starred', getBool, assignToP),
  resolve_pidThing('pid', assignToP, 'post:stars'),
  handlePostStars
);

export default router;
