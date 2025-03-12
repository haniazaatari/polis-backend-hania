import express from 'express';
import {
  handleGetIimConversation,
  handleGetIipConversation,
  handleImplicitConversationGeneration
} from '../controllers/conversationController.js';
import { handleGetPerfStats } from '../controllers/performanceController.js';
import { moveToBody } from '../middlewares/index.js';
import {
  assignToP,
  assignToPCustom,
  getBool,
  getConversationIdFetchZid,
  getStringLimitLength,
  need,
  want
} from '../utils/parameter.js';

const router = express();

/**
 * @route GET /iip/:conversation_id
 * @desc Get IIP conversation
 * @access Public
 */
router.get(
  '/iip/:conversation_id',
  moveToBody,
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  handleGetIipConversation
);

/**
 * @route GET /iim/:conversation_id
 * @desc Get IIM conversation
 * @access Public
 */
router.get(
  '/iim/:conversation_id',
  moveToBody,
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  handleGetIimConversation
);

/**
 * @route GET /polis_site_id.*
 * @desc Implicit conversation generation
 * @access Public
 */
router.get(
  /^\/polis_site_id.*/,
  moveToBody,
  need('parent_url', getStringLimitLength(1, 10000), assignToP),
  want('referrer', getStringLimitLength(1, 10000), assignToP),
  want('auth_needed_to_vote', getBool, assignToP),
  want('auth_needed_to_write', getBool, assignToP),
  want('auth_opt_allow_3rdparty', getBool, assignToP),
  want('show_vis', getBool, assignToP),
  want('show_share', getBool, assignToP),
  want('bg_white', getBool, assignToP),
  want('topic', getStringLimitLength(1, 1000), assignToP),
  want('ucv', getBool, assignToP),
  want('ucw', getBool, assignToP),
  want('ucsh', getBool, assignToP),
  want('ucst', getBool, assignToP),
  want('ucsd', getBool, assignToP),
  want('ucsv', getBool, assignToP),
  want('ucsf', getBool, assignToP),
  want('ui_lang', getStringLimitLength(1, 10), assignToP),
  want('dwok', getStringLimitLength(1, 1000), assignToP),
  want('xid', getStringLimitLength(1, 999), assignToP),
  want('subscribe_type', getStringLimitLength(1, 9), assignToP),
  want('x_name', getStringLimitLength(1, 746), assignToP),
  want('x_profile_image_url', getStringLimitLength(1, 3000), assignToP),
  want('x_email', getStringLimitLength(256), assignToP),
  want('build', getStringLimitLength(300), assignToP),
  handleImplicitConversationGeneration
);

/**
 * @route GET /perfStats_9182738127
 * @desc Get performance statistics
 * @access Admin
 */
router.get('/perfStats_9182738127', moveToBody, handleGetPerfStats);

export default router;
