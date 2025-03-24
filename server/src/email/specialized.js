import _ from 'underscore';
import Config from '../config.js';
import { pgQueryP } from '../db/pg-query.js';
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

Click this link to open your account:

${serverUrl}/ot/${conversation_id}/${suzinvite}

Thank you for using Polis`;
  return sendTextEmail(polisFromAddress, email, 'Join the pol.is conversation!', body);
}

/**
 * Send an email with a link to a newly created conversation
 * @param {string} email - The recipient's email
 * @param {string} conversation_id - The conversation ID
 * @returns {Promise<void>}
 */
function sendCreatedLinkToEmail(email, conversation_id) {
  const body = `Hi there,

Here's a link to the conversation you just created. Use it to invite participants to the conversation. Share it by whatever network you prefer - Gmail, Facebook, Twitter, etc., or just post it to your website or blog. Try it now! Click this link to go to your conversation:

${serverUrl}/${conversation_id}

With gratitude,

The team at pol.is`;
  return sendTextEmail(polisFromAddress, email, `Link: ${serverUrl}/${conversation_id}`, body);
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

Thanks for using Polis!`;
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
  const body = `Conversation created!

You can find the conversation here:
${url}
You can moderate the conversation here:
${modUrl}

We recommend you add 2-3 short statements to start things off. These statements should be easy to agree or disagree with. Here are some examples:
 "I think the proposal is good"
 "This topic matters a lot"
 or "The bike shed should have a metal roof"

You can add statements here:
${seedUrl}

Feel free to reply to this email if you have questions.

Additional info: 
site_id: "${site_id}"
page_id: "${page_id}"
`;

  return pgQueryP('select email from users where site_id = ($1)', [site_id]).then((rows) => {
    const emails = _.pluck(rows, 'email');
    return sendMultipleTextEmails(polisFromAddress, emails, 'Polis conversation created', body);
  });
}

export {
  sendEinviteEmail,
  sendSuzinviteEmail,
  sendCreatedLinkToEmail,
  sendEmailExportReady,
  sendImplicitConversationCreatedEmails
};
