import express from 'express';
import {
  handleCreateReport,
  handleGetReports,
  handlePostReportCommentSelections,
  handleReportNarrative,
  handleUpdateReport
} from '../controllers/reportController.js';
import { auth, authOptional, moveToBody } from '../middlewares/index.js';
import {
  assignToP,
  assignToPCustom,
  getBool,
  getConversationIdFetchZid,
  getInt,
  getReportIdFetchRid,
  getStringLimitLength,
  need,
  want
} from '../utils/parameter.js';

const router = express();

/**
 * @route GET /api/v3/reportNarrative
 * @desc Get a narrative report for a conversation
 * @access Public
 */
router.get(
  '/reportNarrative',
  moveToBody,
  need('report_id', getReportIdFetchRid, assignToPCustom('rid')),
  handleReportNarrative
);

/**
 * @route GET /api/v3/reports
 * @desc Get reports for a conversation or user
 * @access Private
 */
router.get(
  '/reports',
  moveToBody,
  authOptional(assignToP),
  want('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  want('report_id', getReportIdFetchRid, assignToPCustom('rid')),
  handleGetReports
);

/**
 * @route POST /api/v3/reports
 * @desc Create a new report for a conversation
 * @access Private
 */
router.post(
  '/reports',
  auth(assignToP),
  want('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  handleCreateReport
);

/**
 * @route PUT /api/v3/reports
 * @desc Update a report
 * @access Private
 */
router.put(
  '/reports',
  moveToBody,
  auth(assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  need('report_id', getReportIdFetchRid, assignToPCustom('rid')),
  want('report_name', getStringLimitLength(999), assignToP),
  want('label_x_neg', getStringLimitLength(999), assignToP),
  want('label_x_pos', getStringLimitLength(999), assignToP),
  want('label_y_neg', getStringLimitLength(999), assignToP),
  want('label_y_pos', getStringLimitLength(999), assignToP),
  want('label_group_0', getStringLimitLength(999), assignToP),
  want('label_group_1', getStringLimitLength(999), assignToP),
  want('label_group_2', getStringLimitLength(999), assignToP),
  want('label_group_3', getStringLimitLength(999), assignToP),
  want('label_group_4', getStringLimitLength(999), assignToP),
  want('label_group_5', getStringLimitLength(999), assignToP),
  want('label_group_6', getStringLimitLength(999), assignToP),
  want('label_group_7', getStringLimitLength(999), assignToP),
  want('label_group_8', getStringLimitLength(999), assignToP),
  want('label_group_9', getStringLimitLength(999), assignToP),
  handleUpdateReport
);

// POST report comment selections
router.post(
  '/reportCommentSelections',
  auth(assignToPCustom),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  need('report_id', getReportIdFetchRid, assignToPCustom('rid')),
  need('tid', getInt, assignToP),
  need('include', getBool, assignToP),
  handlePostReportCommentSelections
);

export default router;
