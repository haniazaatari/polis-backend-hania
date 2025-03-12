import express from 'express';
import { handlePostContributors } from '../controllers/contributorController.js';
import { authOptional } from '../middlewares/index.js';
import { assignToP, getIntInRange, getStringLimitLength, need } from '../utils/parameter.js';

const router = express();

/**
 * @route POST /api/v3/contributors
 * @desc Create a contributor agreement
 * @access Public (with optional auth)
 */
router.post(
  '/',
  authOptional(assignToP),
  need('agreement_version', getIntInRange(1, 999999), assignToP),
  need('name', getStringLimitLength(746), assignToP),
  need('email', getStringLimitLength(256), assignToP),
  need('github_id', getStringLimitLength(256), assignToP),
  need('company_name', getStringLimitLength(746), assignToP),
  handlePostContributors
);

export default router;
