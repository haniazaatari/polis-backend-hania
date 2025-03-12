import * as upvoteService from '../services/upvote/upvoteService.js';
/**
 * Upvote Controller
 * Handles HTTP requests related to upvoting conversations
 */
import logger from '../utils/logger.js';
import { fail } from '../utils/responseHandlers.js';

/**
 * Handle POST request to upvote a conversation
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handlePostUpvotes(req, res) {
  try {
    const uid = req.p.uid;
    const zid = req.p.zid;

    // Check if user has already upvoted this conversation
    const hasUpvoted = await upvoteService.hasUserUpvotedConversation(uid, zid);
    if (hasUpvoted) {
      return fail(res, 403, 'polis_err_upvote_already_upvoted');
    }

    // Add upvote
    await upvoteService.addUpvote(uid, zid);

    // Update conversation upvote count
    await upvoteService.updateConversationUpvoteCount(zid);

    res.status(200).json({});
  } catch (err) {
    logger.error('Error handling upvote request', err);
    fail(res, 500, 'polis_err_upvote', err);
  }
}

export { handlePostUpvotes };
