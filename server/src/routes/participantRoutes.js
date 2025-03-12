/**
 * Participant Routes
 * Defines API routes for participant-related operations
 */
import express from 'express';
import {
  handleGetParticipants,
  handlePostParticipants,
  handlePutParticipantsExtended,
  handleQueryParticipantsByMetadata
} from '../controllers/participantController.js';
import { auth, authOptional, moveToBody } from '../middlewares/index.js';
import { COOKIES } from '../services/auth/constants.js';
import { handlePostJoinWithInvite } from '../services/participant/participantService.js';
import {
  assignToP,
  assignToPCustom,
  getArrayOfInt,
  getBool,
  getConversationIdFetchZid,
  getOptionalStringLimitLength,
  getStringLimitLength,
  need,
  want,
  wantCookie
} from '../utils/parameter.js';

const router = express();

/**
 * @api {get} /api/v3/participants Get participant
 * @apiName GetParticipant
 * @apiGroup Participants
 * @apiDescription Get a participant by conversation ID and user ID
 *
 * @apiParam {String} conversation_id The conversation ID
 *
 * @apiSuccess {Object} participant The participant object
 */
router.get(
  '/participants',
  moveToBody,
  auth(assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  handleGetParticipants
);

/**
 * @api {post} /api/v3/participants Create or retrieve a participant
 * @apiName PostParticipant
 * @apiGroup Participants
 * @apiDescription Create or retrieve a participant for a conversation
 *
 * @apiParam {String} conversation_id The conversation ID
 * @apiParam {Array} [answers] Answers to participant metadata questions
 * @apiParam {String} [parent_url] Parent URL
 * @apiParam {String} [referrer] Referrer URL
 *
 * @apiSuccess {Object} participant The participant object
 */
router.post(
  '/participants',
  auth(assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  want('answers', getArrayOfInt, assignToP, []),
  want('parent_url', getStringLimitLength(9999), assignToP),
  want('referrer', getStringLimitLength(9999), assignToP),
  handlePostParticipants
);

/**
 * @api {put} /api/v3/participants_extended Update participant extended info
 * @apiName PutParticipantExtended
 * @apiGroup Participants
 * @apiDescription Update participant extended information
 *
 * @apiParam {String} conversation_id The conversation ID
 * @apiParam {Boolean} [show_translation_activated] Whether to show translation
 *
 * @apiSuccess {Object} result The result object
 */
router.put(
  '/participants_extended',
  auth(assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  want('show_translation_activated', getBool, assignToP),
  handlePutParticipantsExtended
);

/**
 * @api {post} /api/v3/joinWithInvite Join a conversation with an invite
 * @apiName JoinWithInvite
 * @apiGroup Participants
 * @apiDescription Join a conversation using a single-use invite or zid
 *
 * @apiParam {String} [suzinvite] Single-use zid invite token
 * @apiParam {Number} [conversation_id] Conversation ID
 * @apiParam {Number} [uid] User ID
 * @apiParam {String} [permanentCookieToken] Permanent cookie token
 * @apiParam {String} [referrer] Referrer URL
 * @apiParam {String} [parent_url] Parent URL
 * @apiParam {Object} [answers] Answers to participant metadata questions
 *
 * @apiSuccess {Number} pid Participant ID
 * @apiSuccess {Number} uid User ID
 */
router.post(
  '/joinWithInvite',
  authOptional(assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  wantCookie(COOKIES.PERMANENT_COOKIE, getOptionalStringLimitLength(32), assignToPCustom('permanentCookieToken')),
  want('suzinvite', getOptionalStringLimitLength(32), assignToP),
  want('answers', getArrayOfInt, assignToP, []),
  want('referrer', getStringLimitLength(9999), assignToP),
  want('parent_url', getStringLimitLength(9999), assignToP),
  handlePostJoinWithInvite
);

/**
 * @route POST /api/v3/query_participants_by_metadata
 * @desc Query participants by metadata
 * @access Private
 */
router.post(
  '/query_participants_by_metadata',
  auth(assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  need('pmaids', getArrayOfInt, assignToP),
  handleQueryParticipantsByMetadata
);

export default router;
