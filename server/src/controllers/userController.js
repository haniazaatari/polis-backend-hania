/**
 * User Controller
 * Handles HTTP requests related to users
 */
import _ from 'underscore';
import { isPolisDev } from '../db/authorization.js';
import * as inviteService from '../services/invite/inviteService.js';
import * as userService from '../services/user/userService.js';
import logger from '../utils/logger.js';
import { fail } from '../utils/responseHandlers.js';

/**
 * Handle GET request to retrieve a user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleGetUsers(req, res) {
  try {
    const uid = req.p.uid;

    // If authentication is required but no user is authenticated, return 401
    if (req.p.errIfNoAuth && !uid) {
      return fail(res, 401, 'polis_error_auth_needed');
    }

    const user = await userService.getUser(uid, req.p.zid, req.p.xid, req.p.owner_uid);
    res.status(200).json(user);
  } catch (err) {
    logger.error('Error getting user info', err);
    fail(res, 500, 'polis_err_getting_user_info', err);
  }
}

/**
 * Handle PUT request to update a user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handlePutUsers(req, res) {
  try {
    let uid = req.p.uid;

    // Allow polis devs to update other users
    if (isPolisDev(uid) && req.p.uid_of_user) {
      uid = req.p.uid_of_user;
    }

    // Build fields object with non-undefined values
    const fields = {};
    if (!_.isUndefined(req.p.email)) {
      fields.email = req.p.email;
    }
    if (!_.isUndefined(req.p.hname)) {
      fields.hname = req.p.hname;
    }

    const result = await userService.updateUser(uid, fields);
    res.json(result);
  } catch (err) {
    logger.error('Error updating user', err);
    fail(res, 500, 'polis_err_put_user', err);
  }
}

/**
 * Handle POST request to invite users to a conversation
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handlePostUsersInvite(req, res) {
  try {
    const uid = req.p.uid;
    const emails = req.p.emails;
    const zid = req.p.zid;
    const conversation_id = req.p.conversation_id;

    await inviteService.inviteUsersToConversation(uid, emails, zid, conversation_id);

    res.status(200).json({
      status: ':-)'
    });
  } catch (err) {
    logger.error('Error inviting users', err);

    // Return appropriate error message based on the error type
    if (err.message === 'polis_err_getting_conversation_info') {
      return fail(res, 500, 'polis_err_getting_conversation_info', err);
    }

    if (err.message === 'polis_err_generating_invites') {
      return fail(res, 500, 'polis_err_generating_invites', err);
    }

    if (err.message === 'polis_err_saving_invites') {
      return fail(res, 500, 'polis_err_saving_invites', err);
    }

    return fail(res, 500, 'polis_err_sending_invite', err);
  }
}

export { handleGetUsers, handlePutUsers, handlePostUsersInvite };
