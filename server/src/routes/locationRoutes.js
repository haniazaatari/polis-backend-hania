import express from 'express';
import { handleGetLocations } from '../controllers/locationController.js';
import { authOptional, moveToBody } from '../middlewares/index.js';
import { assignToP, assignToPCustom, getConversationIdFetchZid, getInt, need } from '../utils/parameter.js';

const router = express();

/**
 * @route GET /api/v3/locations
 * @desc Get locations for participants in a conversation, filtered by group
 * @access Public (with optional auth)
 */
router.get(
  '/',
  moveToBody,
  authOptional(assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  need('gid', getInt, assignToP),
  handleGetLocations
);

export default router;
