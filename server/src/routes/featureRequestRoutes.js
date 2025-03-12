import express from 'express';
import { handleGetDummyButton } from '../controllers/featureRequestController.js';
import { moveToBody } from '../middlewares/index.js';
import { assignToP, getStringLimitLength, need } from '../utils/parameter.js';

const router = express();

/**
 * @route GET /api/v3/dummyButton
 * @desc Submit a feature request via dummy button
 * @access Public
 */
router.get(
  '/',
  moveToBody,
  need('button', getStringLimitLength(1, 999), assignToP),
  need('uid', getStringLimitLength(1, 999), assignToP),
  handleGetDummyButton
);

export default router;
