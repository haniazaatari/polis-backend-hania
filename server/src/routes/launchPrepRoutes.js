import express from 'express';
import { handleLaunchPrep } from '../controllers/launchPrepController.js';
import { moveToBody } from '../middlewares/index.js';
import { assignToP, getStringLimitLength, need } from '../utils/parameter.js';

const router = express();

/**
 * @route GET /api/v3/launchPrep
 * @desc Prepare for launch by setting cookies and redirecting
 * @access Public
 */
router.get('/', moveToBody, need('dest', getStringLimitLength(1, 10000), assignToP), handleLaunchPrep);

export default router;
