import _ from 'underscore';
import { sendEmailByUid } from '../email/senders.js';
import { getZinvite } from '../services/zinvite/zinviteService.js';
import logger from '../utils/logger.js';

/**
 * Create a moderation URL for a conversation
 * @param {string} zinvite - The conversation invite code
 * @returns {string} - The moderation URL
 */
function createModerationUrl(zinvite) {
  return `https://pol.is/${zinvite}/m`;
}

/**
 * Send an email to notify a user about comments that need moderation
 * @param {Object} req - Express request object
 * @param {number} uid - The user ID to send the email to
 * @param {number} zid - The conversation ID
 * @param {number} unmoderatedCommentCount - The number of unmoderated comments
 * @returns {Promise<void>}
 */
function sendCommentModerationEmail(_req, uid, zid, unmoderatedCommentCount) {
  const countDisplay = _.isUndefined(unmoderatedCommentCount) ? '' : unmoderatedCommentCount;
  let body = countDisplay;
  if (unmoderatedCommentCount === 1) {
    body += ' Statement is waiting for your review here: ';
  } else {
    body += ' Statements are waiting for your review here: ';
  }

  getZinvite(zid)
    .catch((err) => {
      logger.error('polis_err_getting_zinvite', err);
      return undefined;
    })
    .then((zinvite) => {
      body += createModerationUrl(zinvite);
      body += '\n\nThank you for using Polis.';
      return sendEmailByUid(uid, `Waiting for review (conversation ${zinvite})`, body);
    })
    .catch((err) => {
      logger.error('polis_err_sending_email', err);
    });
}

export { sendCommentModerationEmail, createModerationUrl };
