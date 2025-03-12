import express from 'express';
import { handleGetTestConnection, handleGetTestDatabase } from '../controllers/healthController.js';

const router = express();

/**
 * @route GET /api/v3/testConnection
 * @desc Test API connection
 * @access Public
 */
router.get('/testConnection', handleGetTestConnection);

/**
 * @route GET /api/v3/testDatabase
 * @desc Test database connection
 * @access Public
 */
router.get('/testDatabase', handleGetTestDatabase);

export default router;
