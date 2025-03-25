import _ from 'underscore';
import { createInviterRecord, createSuzInvites, deleteSuzInviteRecord, getSUZinviteRecord } from '../../db/invites.js';
import { sendSuzinviteEmail } from '../../email/specialized.js';
import logger from '../../utils/logger.js';
import { getConversationInfo } from '../conversation/conversationService.js';
import { generateSUZinvites } from '../url/urlService.js';

/**
 * Get information about a single-use zid invite
 * @param {string} suzinvite - Single-use zid invite token
 * @returns {Promise<Object>} - Object containing zid
 */
async function getSUZinviteInfo(suzinvite) {
  try {
    const rows = await getSUZinviteRecord(suzinvite);

    if (!rows || !rows.length) {
      throw new Error('polis_err_invite_not_found');
    }

    return {
      zid: rows[0].zid,
      suzinvite: suzinvite
    };
  } catch (error) {
    logger.error('Error getting suzinvite info', error);
    throw error;
  }
}

/**
 * Delete a single-use zid invite after it's been used
 * @param {string} suzinvite - Single-use zid invite token
 * @returns {Promise<void>}
 */
async function deleteSuzinvite(suzinvite) {
  try {
    await deleteSuzInviteRecord(suzinvite);
  } catch (error) {
    logger.error('Error deleting suzinvite', error);
    throw error;
  }
}

/**
 * Add a record of who invited an email address
 * @param {number} inviter_uid - User ID of the inviter
 * @param {string} invited_email - Email address of the invitee
 * @returns {Promise<void>}
 */
async function addInviter(inviter_uid, invited_email) {
  try {
    await createInviterRecord(inviter_uid, invited_email);
  } catch (error) {
    logger.error('Error adding inviter record', error);
    throw error;
  }
}

/**
 * Invite users to a conversation
 * @param {number} uid - User ID of the inviter
 * @param {Array<string>} emails - Array of email addresses to invite
 * @param {number} zid - Conversation ID
 * @param {string} conversation_id - Conversation ID string
 * @returns {Promise<void>}
 */
async function inviteUsersToConversation(uid, emails, zid, conversation_id) {
  try {
    // Get conversation info to verify ownership
    const conv = await getConversationInfo(zid);
    const owner = conv.owner;

    // Generate single-use invites
    const suzinviteArray = await generateSUZinvites(emails.length);

    // Create pairs of emails and invites
    const pairs = _.zip(emails, suzinviteArray);

    // Create array of invite data
    const invites = pairs.map(([email, suzinvite]) => ({
      suzinvite,
      xid: email,
      zid,
      owner
    }));

    try {
      await createSuzInvites(invites);
    } catch (_) {
      throw new Error('polis_err_saving_invites');
    }

    // Send emails and record inviters
    await Promise.all(
      pairs.map(async ([email, suzinvite]) => {
        try {
          await sendSuzinviteEmail(email, conversation_id, suzinvite);
          await addInviter(uid, email);
        } catch (_) {
          throw new Error('polis_err_sending_invite');
        }
      })
    );
  } catch (error) {
    // Pass through specific error messages
    if (error.message === 'polis_err_saving_invites' || error.message === 'polis_err_sending_invite') {
      throw error;
    }

    // For conversation info errors
    logger.error('Error inviting users to conversation', error);
    throw new Error('polis_err_getting_conversation_info');
  }
}

export { getSUZinviteInfo, deleteSuzinvite, addInviter, inviteUsersToConversation };
