import express from 'express';
import {
  handleCreateVote,
  handleGetFamousVotes,
  handleGetVotes,
  handleGetVotesForMe
} from '../controllers/voteController.js';
import { auth, authOptional, moveToBody } from '../middlewares/index.js';
import {
  assignToP,
  assignToPCustom,
  getBool,
  getConversationIdFetchZid,
  getInt,
  getIntInRange,
  getStringLimitLength,
  need,
  resolve_pidThing,
  want
} from '../utils/parameter.js';

const router = express();

/**
 * @route GET /votes
 * @desc Get votes for a conversation
 * @access Public (with optional auth)
 */
router.get(
  '/',
  moveToBody,
  authOptional(assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  want('tid', getInt, assignToP),
  resolve_pidThing('pid', assignToP, 'get:votes'),
  handleGetVotes
);

/**
 * @route GET /votes/me
 * @desc Get votes for the current user
 * @access Private
 */
router.get(
  '/me',
  moveToBody,
  auth(assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  handleGetVotesForMe
);

/**
 * @route GET /votes/famous
 * @desc Get famous votes for a conversation
 * @access Public (with optional auth)
 */
router.get(
  '/famous',
  moveToBody,
  authOptional(assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  want('math_tick', getInt, assignToP, -1),
  want('ptptoiLimit', getIntInRange(0, 99), assignToP),
  handleGetFamousVotes
);

/**
 * @route POST /votes
 * @desc Create a new vote
 * @access Private
 */
router.post(
  '/',
  auth(assignToP),
  need('tid', getInt, assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  need('vote', getIntInRange(-1, 1), assignToP),
  want('starred', getBool, assignToP),
  want('high_priority', getBool, assignToP, false),
  resolve_pidThing('pid', assignToP, 'post:votes'),
  want('xid', getStringLimitLength(1, 999), assignToP),
  want('lang', getStringLimitLength(1, 10), assignToP),
  handleCreateVote
);

export default router;
