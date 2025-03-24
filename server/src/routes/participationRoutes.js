/**
 * Participation Routes
 * Defines API routes for participation-related operations
 */
import express from 'express';
import { handleGetParticipation, handleGetParticipationInit } from '../controllers/participationController.js';
import {
  auth,
  authOptional,
  denyIfNotFromWhitelistedDomain,
  moveToBody,
  resolveParticipantId
} from '../middlewares/index.js';
import {
  assignToP,
  assignToPCustom,
  getBool,
  getConversationIdFetchZid,
  getInt,
  getStringLimitLength,
  need,
  want
} from '../utils/parameter.js';

const router = express();

/**
 * @api {get} /api/v3/participation Get participation data
 * @apiName GetParticipation
 * @apiGroup Participation
 * @apiDescription Get participation data for a conversation
 *
 * @apiParam {String} conversation_id The conversation ID
 * @apiParam {Boolean} [strict] Whether to enforce strict XID validation
 *
 * @apiSuccess {Object} result Participation data
 */
router.get(
  '/participation',
  moveToBody,
  auth(assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  want('strict', getBool, assignToP),
  handleGetParticipation
);

/**
 * @api {get} /api/v3/participationInit Initialize participation
 * @apiName GetParticipationInit
 * @apiGroup Participation
 * @apiDescription Initialize participation for a conversation
 *
 * @apiParam {String} [conversation_id] The conversation ID
 * @apiParam {Number} [ptptoiLimit] Limit for participant to include
 * @apiParam {String} [lang] Language code
 * @apiParam {String} [domain_whitelist_override_key] Domain whitelist override key
 * @apiParam {String} [xid] External ID
 *
 * @apiSuccess {Object} result Participation initialization data
 */
router.get(
  '/participationInit',
  moveToBody,
  authOptional(assignToP),
  want('ptptoiLimit', getInt, assignToP),
  want('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  want('conversation_id', getStringLimitLength(1, 1000), assignToP),
  want('lang', getStringLimitLength(1, 10), assignToP),
  want('domain_whitelist_override_key', getStringLimitLength(1, 1000), assignToP),
  denyIfNotFromWhitelistedDomain,
  want('xid', getStringLimitLength(1, 999), assignToP),
  resolveParticipantId('pid', assignToP, 'get:votes'),
  handleGetParticipationInit
);

export default router;
