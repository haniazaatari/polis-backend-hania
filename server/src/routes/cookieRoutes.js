import express from 'express';
import { handleTryCookie } from '../controllers/cookieController.js';
import { moveToBody } from '../middlewares/moveToBody.js';
const router = express();

/**
 * @api {get} /tryCookie Test cookie functionality
 * @apiName TryCookie
 * @apiGroup Auth
 * @apiDescription Tests if cookies can be set and read
 *
 * @apiSuccess {Object} empty Empty JSON object
 */
router.get('/', moveToBody, handleTryCookie);

export default router;
