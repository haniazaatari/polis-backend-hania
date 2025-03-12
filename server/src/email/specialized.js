import Config from '../config.js';
import { polisFromAddress, sendMultipleTextEmails, sendTextEmail } from './senders.js';

const serverUrl = Config.serverUrl;

/**
 * Send an email with a verification link
 * @param {string} email - The recipient's email
 * @param {string} einvite - The email invite code
 * @returns {Promise<void>}
 */
function sendEinviteEmail(email, einvite) {
  const body = `Welcome to pol.is!

Click this link to open your account:

${serverUrl}/welcome/${einvite}

Thank you for using Polis`;
  return sendTextEmail(polisFromAddress, email, 'Get Started with Polis', body);
}

/**
 * Send an email with a single-use invite link
 * @param {string} email - The recipient's email
 * @param {string} conversation_id - The conversation ID
 * @param {string} suzinvite - The single-use invite code
 * @returns {Promise<void>}
 */
function sendSuzinviteEmail(email, conversation_id, suzinvite) {
  const body = `Welcome to pol.is!

You've been invited to join the conversation "${conversation_id}".

Click this link to join:

${serverUrl}/${conversation_id}/${suzinvite}

Thank you for using Polis`;
  return sendTextEmail(polisFromAddress, email, `Join the conversation: ${conversation_id}`, body);
}

/**
 * Send an email with a link to a newly created conversation
 * @param {string} email - The recipient's email
 * @param {string} conversation_id - The conversation ID
 * @returns {Promise<void>}
 */
function sendCreatedLinkToEmail(email, conversation_id) {
  const body = `Your conversation is ready.

You can view your conversation here:
${serverUrl}/${conversation_id}

You can moderate your conversation here:
${serverUrl}/${conversation_id}/m

You can see the results here:
${serverUrl}/${conversation_id}/r

Share this link on Twitter, Facebook, or by email:
${serverUrl}/${conversation_id}`;
  return sendTextEmail(polisFromAddress, email, 'Your pol.is conversation is ready!', body);
}

/**
 * Send an email with a link to data export results
 * @param {string} email - The recipient's email
 * @param {string} conversation_id - The conversation ID
 * @param {string} filename - The export filename
 * @returns {Promise<void>}
 */
function sendEmailExportReady(email, conversation_id, filename) {
  const subject = `Polis data export for conversation pol.is/${conversation_id}`;
  const fromAddress = `Polis Team <${Config.adminEmailDataExport}>`;
  const body = `Greetings

You created a data export for conversation ${serverUrl}/${conversation_id} that has just completed. You can download the results for this conversation at the following url:

${serverUrl}/api/v3/dataExport/results?filename=${filename}&conversation_id=${conversation_id}

Please let us know if you have any questions about the data.

Thanks for using Polis!
`;
  return sendTextEmail(fromAddress, email, subject, body);
}

/**
 * Send emails to notify about an implicitly created conversation
 * @param {number} site_id - The site ID
 * @param {string} page_id - The page ID
 * @param {string} url - The conversation URL
 * @param {string} modUrl - The moderation URL
 * @param {string} seedUrl - The seed URL
 * @returns {Promise<void>}
 */
function sendImplicitConversationCreatedEmails(site_id, page_id, url, modUrl, seedUrl) {
  return sendMultipleTextEmails(
    polisFromAddress,
    Config.adminEmailsForImplicitPolis,
    `Implicit conversation created for site: ${site_id} page: ${page_id}`,
    `Conversation URL: ${url}
Moderate URL: ${modUrl}
Seed URL: ${seedUrl}`
  );
}

export {
  sendEinviteEmail,
  sendSuzinviteEmail,
  sendCreatedLinkToEmail,
  sendEmailExportReady,
  sendImplicitConversationCreatedEmails
};
