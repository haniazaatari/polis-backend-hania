import express from 'express';
import { handleGetReportExport } from '../controllers/exportController.js';
import { authOptional, moveToBody } from '../middlewares/index.js';
import { assignToP, assignToPCustom, getReportIdFetchRid, getStringLimitLength, need } from '../utils/parameter.js';

const router = express();

// Route for report export
router.get(
  '/:report_id/:report_type',
  authOptional(assignToP),
  moveToBody,
  need('report_id', getReportIdFetchRid, assignToPCustom('rid')),
  need('report_id', getStringLimitLength(1, 1000), assignToP),
  need('report_type', getStringLimitLength(1, 1000), assignToP),
  handleGetReportExport
);

export default router;
