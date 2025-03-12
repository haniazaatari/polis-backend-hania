import express from 'express';
import {
  handleDeleteMetadataAnswer,
  handleDeleteMetadataQuestion,
  handleGetAllMetadata,
  handleGetMetadataAnswers,
  handleGetMetadataChoices,
  handleGetMetadataQuestions,
  handlePostMetadataAnswer,
  handlePostMetadataQuestion
} from '../controllers/metadataController.js';
import { auth, authOptional, moveToBody } from '../middlewares/index.js';
import {
  assignToP,
  assignToPCustom,
  getConversationIdFetchZid,
  getInt,
  getOptionalStringLimitLength,
  need,
  want
} from '../utils/parameter.js';

const router = express();

/**
 * @route DELETE /questions/:pmqid
 * @desc Delete a metadata question
 * @access Private
 */
router.delete(
  '/questions/:pmqid',
  moveToBody,
  auth(assignToP),
  need('pmqid', getInt, assignToP),
  handleDeleteMetadataQuestion
);

/**
 * @route DELETE /answers/:pmaid
 * @desc Delete a metadata answer
 * @access Private
 */
router.delete(
  '/answers/:pmaid',
  moveToBody,
  auth(assignToP),
  need('pmaid', getInt, assignToP),
  handleDeleteMetadataAnswer
);

/**
 * @route GET /questions
 * @desc Get metadata questions for a conversation
 * @access Public (with optional auth)
 */
router.get(
  '/questions',
  moveToBody,
  authOptional(assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  want('suzinvite', getOptionalStringLimitLength(32), assignToP),
  want('zinvite', getOptionalStringLimitLength(300), assignToP),
  handleGetMetadataQuestions
);

/**
 * @route POST /questions
 * @desc Create a metadata question
 * @access Private
 */
router.post(
  '/questions',
  moveToBody,
  auth(assignToP),
  need('key', getOptionalStringLimitLength(999), assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  handlePostMetadataQuestion
);

/**
 * @route POST /answers
 * @desc Create a metadata answer
 * @access Private
 */
router.post(
  '/answers',
  moveToBody,
  auth(assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  need('pmqid', getInt, assignToP),
  need('value', getOptionalStringLimitLength(999), assignToP),
  handlePostMetadataAnswer
);

/**
 * @route GET /choices
 * @desc Get metadata choices for a conversation
 * @access Private
 */
router.get(
  '/choices',
  moveToBody,
  auth(assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  handleGetMetadataChoices
);

/**
 * @route GET /answers
 * @desc Get metadata answers for a conversation
 * @access Public (with optional auth)
 */
router.get(
  '/answers',
  moveToBody,
  authOptional(assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  want('pmqid', getInt, assignToP),
  want('suzinvite', getOptionalStringLimitLength(32), assignToP),
  want('zinvite', getOptionalStringLimitLength(300), assignToP),
  handleGetMetadataAnswers
);

/**
 * @route GET /
 * @desc Get all metadata for a conversation
 * @access Private
 */
router.get(
  '/',
  moveToBody,
  auth(assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  want('zinvite', getOptionalStringLimitLength(300), assignToP),
  want('suzinvite', getOptionalStringLimitLength(32), assignToP),
  handleGetAllMetadata
);

export default router;
