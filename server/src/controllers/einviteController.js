import { getEinviteInfo, sendEmailInvite } from '../services/einvite/einviteService.js';
import { fail } from '../utils/responseHandlers.js';

/**
 * Handle POST request to send an email invite
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handlePostEinvites(req, res) {
  try {
    await sendEmailInvite(req.p.email);
    res.status(200).json({});
  } catch (err) {
    fail(res, 500, 'polis_err_sending_einvite', err);
  }
}

/**
 * Handle GET request to retrieve an email invite
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleGetEinvites(req, res) {
  try {
    const info = await getEinviteInfo(req.p.einvite);
    res.status(200).json(info);
  } catch (err) {
    fail(res, 500, 'polis_err_fetching_einvite', err);
  }
}

export { handlePostEinvites, handleGetEinvites };
