import express from 'express';
import { handleGetGroupDemographics } from '../controllers/demographicsController.js';
import { authOptional } from '../middlewares/auth.js';
import { moveToBody } from '../middlewares/moveToBody.js';
import {
  assignToP,
  assignToPCustom,
  getConversationIdFetchZid,
  getReportIdFetchRid,
  need,
  want
} from '../utils/parameter.js';

const router = express();

/**
 * GET /api/v3/group_demographics
 * Get group demographics for a conversation
 * Requires zid and either moderator status or a report ID
 */
router.get(
  '/',
  moveToBody,
  authOptional(assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  want('report_id', getReportIdFetchRid, assignToPCustom('rid')),
  handleGetGroupDemographics
);

export default router;
