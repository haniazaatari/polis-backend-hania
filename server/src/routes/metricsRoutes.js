import express from 'express';
import { handlePostMetrics } from '../controllers/metricsController.js';
import { authOptional } from '../middlewares/index.js';
import { assignToP, getArrayOfInt, getInt, need } from '../utils/parameter.js';

const router = express();

/**
 * @route POST /api/v3/metrics
 * @desc Record client-side metrics
 * @access Public (with optional auth)
 */
router.post(
  '/',
  authOptional(assignToP),
  need('types', getArrayOfInt, assignToP),
  need('times', getArrayOfInt, assignToP),
  need('durs', getArrayOfInt, assignToP),
  need('clientTimestamp', getInt, assignToP),
  handlePostMetrics
);

export default router;
