import express from 'express';
import { handleGetContexts, handlePostContexts } from '../controllers/contextController.js';
import { auth, authOptional } from '../middlewares/auth.js';
import { moveToBody } from '../middlewares/index.js';
import { assignToP, getStringLimitLength, need } from '../utils/parameter.js';

const router = express();

/**
 * @route GET /api/v3/contexts
 * @desc Get all public contexts
 * @access Public (with optional auth)
 */
router.get('/', moveToBody, authOptional(assignToP), handleGetContexts);

/**
 * @route POST /api/v3/contexts
 * @desc Create a new context
 * @access Private
 */
router.post('/', auth(assignToP), need('name', getStringLimitLength(1, 300), assignToP), handlePostContexts);

export default router;
