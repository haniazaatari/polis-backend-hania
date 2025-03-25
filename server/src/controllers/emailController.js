import Config from '../config.js';
import { emailTeam } from '../email/senders.js';
import { sendCreatedLinkToEmail, sendEmailExportReady } from '../email/specialized.js';
import { fail } from '../utils/responseHandlers.js';

/**
 * Handle POST request to send a created conversation link to email
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleSendCreatedLinkToEmail(req, res) {
  if (!req.p.email) {
    fail(res, 400, 'polis_err_need_email');
    return;
  }

  try {
    await sendCreatedLinkToEmail(req.p.email, req.p.conversation_id);
    res.status(200).json({});
  } catch (err) {
    fail(res, 500, 'polis_err_sending_created_link_to_email', err);
  }
}

/**
 * Handle POST request to send an email export ready notification
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleSendEmailExportReady(req, res) {
  if (req.p.webserver_pass !== Config.webserverPass || req.p.webserver_username !== Config.webserverUsername) {
    return fail(res, 403, 'polis_err_sending_export_link_to_email_auth');
  }

  try {
    await sendEmailExportReady(req.p.email, req.p.conversation_id, req.p.filename);
    res.status(200).json({});
  } catch (err) {
    fail(res, 500, 'polis_err_sending_export_link_to_email', err);
  }
}

/**
 * Handle POST request to notify the team
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleNotifyTeam(req, res) {
  if (req.p.webserver_pass !== Config.webserverPass || req.p.webserver_username !== Config.webserverUsername) {
    return fail(res, 403, 'polis_err_notifying_team_auth');
  }

  try {
    await emailTeam(req.p.subject, req.p.body);
    res.status(200).json({});
  } catch (err) {
    fail(res, 500, 'polis_err_notifying_team', err);
  }
}

export { handleSendCreatedLinkToEmail, handleSendEmailExportReady, handleNotifyTeam };
