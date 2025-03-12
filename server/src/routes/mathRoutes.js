import express from 'express';
import {
  handleGetBid,
  handleGetBidToPid,
  handleGetMathCorrelationMatrix,
  handleGetMathPca,
  handleGetMathPca2,
  handleGetXids,
  handlePostMathUpdate,
  handlePostXidWhitelist
} from '../controllers/mathController.js';
import { auth, authOptional, moveToBody, redirectIfHasZidButNoConversationId } from '../middlewares/index.js';
import {
  assignToP,
  assignToPCustom,
  getArrayOfStringNonEmptyLimitLength,
  getConversationIdFetchZid,
  getInt,
  getReportIdFetchRid,
  getStringLimitLength,
  need,
  want,
  wantHeader
} from '../utils/parameter.js';

const router = express();

/**
 * @route GET /math/pca
 * @desc Legacy endpoint - returns 304
 * @access Public
 */
router.get('/math/pca', handleGetMathPca);

/**
 * @route GET /math/pca2
 * @desc Get PCA data for a conversation
 * @access Public
 */
router.get(
  '/math/pca2',
  moveToBody,
  redirectIfHasZidButNoConversationId,
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  want('math_tick', getInt, assignToP),
  wantHeader('If-None-Match', getStringLimitLength(1000), assignToPCustom('ifNoneMatch')),
  handleGetMathPca2
);

/**
 * @route POST /mathUpdate
 * @desc Update math for a conversation
 * @access Private
 */
router.post(
  '/mathUpdate',
  moveToBody,
  auth(assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  need('math_update_type', getStringLimitLength(1, 32), assignToP),
  handlePostMathUpdate
);

/**
 * @route GET /math/correlationMatrix
 * @desc Get correlation matrix for a report
 * @access Public
 */
router.get(
  '/math/correlationMatrix',
  moveToBody,
  need('report_id', getReportIdFetchRid, assignToPCustom('rid')),
  want('math_tick', getInt, assignToP, -1),
  handleGetMathCorrelationMatrix
);

/**
 * @route GET /bidToPid
 * @desc Get bid to pid mapping for a conversation
 * @access Public (with optional auth)
 */
router.get(
  '/bidToPid',
  authOptional(assignToP),
  moveToBody,
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  want('math_tick', getInt, assignToP, 0),
  handleGetBidToPid
);

/**
 * @route GET /xids
 * @desc Get XIDs for a conversation
 * @access Private
 */
router.get(
  '/xids',
  moveToBody,
  auth(assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  handleGetXids
);

/**
 * @route POST /xidWhitelist
 * @desc Add XIDs to whitelist
 * @access Private
 */
router.post(
  '/xidWhitelist',
  auth(assignToP),
  need('xid_whitelist', getArrayOfStringNonEmptyLimitLength(9999, 999), assignToP),
  handlePostXidWhitelist
);

/**
 * @route GET /bid
 * @desc Get bid for a participant
 * @access Private
 */
router.get(
  '/bid',
  moveToBody,
  auth(assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  want('math_tick', getInt, assignToP, 0),
  handleGetBid
);

export default router;
