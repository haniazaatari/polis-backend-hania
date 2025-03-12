import timeout from 'connect-timeout';
import express from 'express';
import {
  handleGetComments,
  handleGetCommentsTranslations,
  handleGetNextComment,
  handlePostComments,
  handlePostPtptCommentMod,
  handlePutComments
} from '../controllers/commentController.js';
import { auth, authOptional, getParticipantIdMiddleware, moveToBody } from '../middlewares/index.js';
import {
  assignToP,
  assignToPCustom,
  getArrayOfInt,
  getBool,
  getConversationIdFetchZid,
  getInt,
  getIntInRange,
  getNumberInRange,
  getOptionalStringLimitLength,
  getStringLimitLength,
  getUrlLimitLength,
  need,
  resolve_pidThing,
  want
} from '../utils/parameter.js';
import { fail } from '../utils/responseHandlers.js';

const router = express();

function haltOnTimeout(req, res, next) {
  if (req.timedout) {
    fail(res, 500, 'polis_err_timeout_misc');
  } else {
    next();
  }
}

/**
 * @api {post} /comments Create a new comment
 * @apiName CreateComment
 * @apiGroup Comments
 * @apiDescription Create a new comment in a conversation
 *
 * @apiParam {String} conversation_id The conversation ID
 * @apiParam {String} [txt] The comment text
 * @apiParam {Number} [vote] The vote value (-1, 0, 1)
 * @apiParam {String} [quote_txt] The quoted text
 * @apiParam {String} [quote_src_url] The source URL of the quote
 * @apiParam {Boolean} [anon] Whether the comment is anonymous
 * @apiParam {Boolean} [is_seed] Whether the comment is a seed comment
 * @apiParam {String} [xid] The external ID
 *
 * @apiSuccess {Number} tid The comment ID
 * @apiSuccess {Number} currentPid The participant ID
 */
router.post(
  '/comments',
  auth(assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  want('txt', getOptionalStringLimitLength(997), assignToP),
  want('vote', getIntInRange(-1, 1), assignToP),
  want('quote_txt', getStringLimitLength(999), assignToP),
  want('quote_src_url', getUrlLimitLength(999), assignToP),
  want('anon', getBool, assignToP),
  want('is_seed', getBool, assignToP),
  want('xid', getStringLimitLength(1, 999), assignToP),
  resolve_pidThing('pid', assignToP, 'post:comments'),
  handlePostComments
);

/**
 * @api {get} /comments Get comments
 * @apiName GetComments
 * @apiGroup Comments
 * @apiDescription Get comments for a conversation
 *
 * @apiParam {String} conversation_id The conversation ID
 * @apiParam {Number} [pid] The participant ID
 * @apiParam {String} [tids] Comma-separated list of comment IDs to include
 * @apiParam {String} [not_voted_by_pid] Exclude comments voted by this participant
 * @apiParam {String} [withoutTids] Comma-separated list of comment IDs to exclude
 * @apiParam {Number} [mod] Moderation status
 * @apiParam {Boolean} [random] Return comments in random order
 * @apiParam {Number} [limit] Maximum number of comments to return
 * @apiParam {Boolean} [include_demographics] Include demographic information
 * @apiParam {Boolean} [moderation] Get comments for moderation
 *
 * @apiSuccess {Array} data Array of comments
 */
router.get(
  '/comments',
  auth(assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  want('pid', getIntInRange(0, 999999), assignToP),
  want('tids', getOptionalStringLimitLength(999), assignToP, (tids) => {
    return tids.split(',').map((tid) => Number(tid));
  }),
  want('not_voted_by_pid', getIntInRange(0, 999999), assignToP),
  want('withoutTids', getOptionalStringLimitLength(999), assignToP, (withoutTids) => {
    return withoutTids.split(',').map((tid) => Number(tid));
  }),
  want('mod', getIntInRange(-1, 9), assignToP),
  want('random', getBool, assignToP),
  want('limit', getIntInRange(1, 999), assignToP),
  want('include_demographics', getBool, assignToP),
  want('moderation', getBool, assignToP),
  handleGetComments
);

/**
 * @api {get} /api/v3/comments/translations Get comment translations
 * @apiName GetCommentTranslations
 * @apiGroup Comments
 * @apiDescription Get translations for a comment
 *
 * @apiParam {String} conversation_id The conversation ID
 * @apiParam {Number} tid The comment ID
 * @apiParam {String} lang The language code
 *
 * @apiSuccess {Array} data Array of translations
 */
router.get(
  '/comments/translations',
  auth(assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  want('tid', getInt, assignToP),
  want('lang', getStringLimitLength(1, 10), assignToP),
  handleGetCommentsTranslations
);

/**
 * @api {get} /api/v3/nextComment Get the next comment
 * @apiName GetNextComment
 * @apiGroup Comments
 * @apiDescription Get the next comment for a participant to vote on
 *
 * @apiParam {String} conversation_id The conversation ID
 * @apiParam {Number} [not_voted_by_pid] The participant ID that hasn't voted on the comment
 * @apiParam {Array} [without] Array of comment IDs to exclude
 * @apiParam {Boolean} [include_social] Whether to include social data
 * @apiParam {String} [lang] The language code
 *
 * @apiSuccess {Object} comment The next comment
 */
router.get(
  '/nextComment',
  timeout(15000),
  moveToBody,
  authOptional(assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  resolve_pidThing('not_voted_by_pid', assignToP, 'get:nextComment'),
  want('without', getArrayOfInt, assignToP),
  want('include_social', getBool, assignToP),
  want('lang', getStringLimitLength(1, 10), assignToP),
  haltOnTimeout,
  handleGetNextComment
);

/**
 * @api {post} /api/v3/ptptCommentMod Submit participant comment moderation
 * @apiName PostPtptCommentMod
 * @apiGroup Comments
 * @apiDescription Submit participant moderation for a comment
 *
 * @apiParam {String} conversation_id The conversation ID
 * @apiParam {Number} tid The comment ID
 * @apiParam {Boolean} [as_abusive] Whether the comment is abusive
 * @apiParam {Boolean} [as_factual] Whether the comment is factual
 * @apiParam {Boolean} [as_feeling] Whether the comment is a feeling
 * @apiParam {Boolean} [as_important] Whether the comment is important
 * @apiParam {Boolean} [as_notfact] Whether the comment is not a fact
 * @apiParam {Boolean} [as_notgoodidea] Whether the comment is not a good idea
 * @apiParam {Boolean} [as_notmyfeeling] Whether the comment is not my feeling
 * @apiParam {Boolean} [as_offtopic] Whether the comment is off-topic
 * @apiParam {Boolean} [as_spam] Whether the comment is spam
 * @apiParam {Boolean} [as_unsure] Whether the user is unsure about the comment
 *
 * @apiSuccess {Object} result The result object
 * @apiSuccess {Object} [result.nextComment] The next comment
 * @apiSuccess {Number} result.currentPid The current participant ID
 */
router.post(
  '/ptptCommentMod',
  auth(assignToP),
  need('tid', getInt, assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  want('as_abusive', getBool, assignToP, null),
  want('as_factual', getBool, assignToP, null),
  want('as_feeling', getBool, assignToP, null),
  want('as_important', getBool, assignToP, null),
  want('as_notfact', getBool, assignToP, null),
  want('as_notgoodidea', getBool, assignToP, null),
  want('as_notmyfeeling', getBool, assignToP, null),
  want('as_offtopic', getBool, assignToP, null),
  want('as_spam', getBool, assignToP, null),
  want('as_unsure', getBool, assignToP, null),
  getParticipantIdMiddleware(assignToP),
  handlePostPtptCommentMod
);

/**
 * @api {put} /api/v3/comments Update a comment
 * @apiName PutComment
 * @apiGroup Comments
 * @apiDescription Update a comment (moderator only)
 *
 * @apiParam {String} conversation_id The conversation ID
 * @apiParam {Number} tid The comment ID
 * @apiParam {Boolean} active Whether the comment is active
 * @apiParam {Number} mod The moderation status
 * @apiParam {Boolean} is_meta Whether the comment is meta
 * @apiParam {Number} velocity The comment velocity
 *
 * @apiSuccess {Object} result Empty object on success
 */
router.put(
  '/comments',
  moveToBody,
  auth(assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  need('tid', getInt, assignToP),
  need('active', getBool, assignToP),
  need('mod', getInt, assignToP),
  need('is_meta', getBool, assignToP),
  need('velocity', getNumberInRange(0, 1), assignToP),
  handlePutComments
);

export default router;
