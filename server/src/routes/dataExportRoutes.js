import express from 'express';
import { handleDataExportRequest, handleDataExportResults } from '../controllers/dataExportController.js';
import { auth, moveToBody } from '../middlewares/index.js';
import {
  assignToP,
  getConversationIdFetchZid,
  getInt,
  getOptionalStringLimitLength,
  getStringLimitLength,
  need,
  want
} from '../utils/parameter.js';

const router = express();

/**
 * @route GET /api/v3/dataExport
 * @desc Request a data export for a conversation
 * @access Private
 */
router.get(
  '/',
  moveToBody,
  auth(assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToP),
  need('conversation_id', getStringLimitLength(1, 1000), assignToP),
  want('unixTimestamp', getInt, assignToP),
  want('format', getOptionalStringLimitLength(100), assignToP),
  handleDataExportRequest
);

/**
 * @route GET /api/v3/dataExport/results
 * @desc Get the results of a data export
 * @access Private
 */
router.get(
  '/results',
  moveToBody,
  auth(assignToP),
  need('filename', getStringLimitLength(1, 1000), assignToP),
  handleDataExportResults
);

export default router;
