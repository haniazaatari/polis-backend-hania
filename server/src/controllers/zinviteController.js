import * as zinviteService from '../services/zinvite/zinviteService.js';
/**
 * Zinvite Controller
 * Handles HTTP requests related to zinvites (conversation invitations)
 */
import logger from '../utils/logger.js';
import { fail } from '../utils/responseHandlers.js';

/**
 * Handle GET request to retrieve zinvites for a conversation
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleGetZinvites(req, res) {
  try {
    const zid = req.p.zid;
    const uid = req.p.uid;

    // Verify that the user owns the conversation
    const isOwner = await zinviteService.isConversationOwner(zid, uid);
    if (!isOwner) {
      return fail(res, 500, 'polis_err_fetching_zinvite_invalid_conversation_or_owner');
    }

    // Get all zinvites for the conversation
    const zinvites = await zinviteService.getZinvitesForConversation(zid);
    if (!zinvites || zinvites.length === 0) {
      return res.status(404).json({
        status: 404
      });
    }

    res.status(200).json({
      codes: zinvites
    });
  } catch (err) {
    logger.error('Error getting zinvites', err);
    fail(res, 500, 'polis_err_fetching_zinvite_invalid_conversation_or_owner_or_something', err);
  }
}

/**
 * Handle POST request to create a new zinvite for a conversation
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handlePostZinvites(req, res) {
  try {
    const zid = req.p.zid;
    const uid = req.p.uid;
    const generateShortUrl = req.p.short_url;

    // Verify that the user owns the conversation
    const isOwner = await zinviteService.isConversationOwner(zid, uid);
    if (!isOwner) {
      return fail(res, 500, 'polis_err_creating_zinvite_invalid_conversation_or_owner');
    }

    // Generate and register a new zinvite
    const zinvite = await zinviteService.generateAndRegisterZinvite(zid, generateShortUrl);

    res.status(200).json({
      zinvite: zinvite
    });
  } catch (err) {
    logger.error('Error creating zinvite', err);
    fail(res, 500, 'polis_err_creating_zinvite', err);
  }
}

export { handleGetZinvites, handlePostZinvites };
