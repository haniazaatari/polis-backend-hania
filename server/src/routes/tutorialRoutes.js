import express from 'express';
import { handlePostTutorial } from '../controllers/tutorialController.js';
import { auth } from '../middlewares/index.js';
import { assignToP, getInt, need } from '../utils/parameter.js';

const router = express();

/**
 * @route POST /api/v3/tutorial
 * @desc Update tutorial step
 * @access Private
 */
router.post('/', auth(assignToP), need('step', getInt, assignToP), handlePostTutorial);

export default router;
