import express from 'express';
import { handleGetSnapshot } from '../controllers/snapshotController.js';

const router = express();

/**
 * @route GET /api/v3/snapshot
 * @desc Create a database snapshot
 * @access Admin
 */
router.get('/', handleGetSnapshot);

export default router;
