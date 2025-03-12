import {
  getCommentGroupsSummary,
  getCommentSummary,
  getConversationSummary,
  getParticipantVotesSummary,
  getVotesSummary
} from '../services/export/exportService.js';
import { fail } from '../utils/responseHandlers.js';

/**
 * Handle GET request for conversation summary
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {Promise<string>} - CSV string
 */
export const handleGetConversationSummary = async (req, res) => {
  try {
    const { zid } = req.p;
    const siteUrl = `${req.headers['x-forwarded-proto']}://${req.headers.host}`;

    const csv = await getConversationSummary(zid, siteUrl);

    res.setHeader('content-type', 'text/csv');
    res.send(csv);
  } catch (err) {
    const msg = err?.message?.startsWith('polis_') ? err.message : 'polis_err_export';
    fail(res, 500, msg, err);
  }
};

/**
 * Handle GET request for comment summary
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {Promise<string>} - CSV string
 */
export const handleGetCommentSummary = async (req, res) => {
  try {
    const { zid } = req.p;

    const csv = await getCommentSummary(zid);

    res.setHeader('content-type', 'text/csv');
    res.send(csv);
  } catch (err) {
    const msg = err?.message?.startsWith('polis_') ? err.message : 'polis_err_export';
    fail(res, 500, msg, err);
  }
};

/**
 * Handle GET request for votes summary
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {Promise<string>} - CSV string
 */
export const handleGetVotesSummary = async (req, res) => {
  try {
    const { zid } = req.p;

    const csv = await getVotesSummary(zid);

    res.setHeader('content-type', 'text/csv');
    res.send(csv);
  } catch (err) {
    const msg = err?.message?.startsWith('polis_') ? err.message : 'polis_err_export';
    fail(res, 500, msg, err);
  }
};

/**
 * Handle GET request for participant votes summary
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const handleGetParticipantVotesSummary = async (req, res) => {
  try {
    const { zid } = req.p;

    const csv = await getParticipantVotesSummary(zid);

    res.setHeader('content-type', 'text/csv');
    res.send(csv);
  } catch (err) {
    const msg = err?.message?.startsWith('polis_') ? err.message : 'polis_err_export';
    fail(res, 500, msg, err);
  }
};

/**
 * Handle GET request for comment groups summary
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {Promise<string>} - CSV string
 */
export const handleGetCommentGroupsSummary = async (req, res) => {
  try {
    const { zid } = req.p;

    const csv = await getCommentGroupsSummary(zid);

    // Otherwise, send as HTTP response
    res.setHeader('content-type', 'text/csv');
    res.send(csv);
  } catch (err) {
    const msg = err?.message?.startsWith('polis_') ? err.message : 'polis_err_export';

    // Otherwise, send an HTTP error response
    fail(res, 500, msg, err);
  }
};

/**
 * Handle GET request for report export
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const handleGetReportExport = async (req, res) => {
  try {
    const { report_type } = req.p;

    switch (report_type) {
      case 'summary.csv':
        await handleGetConversationSummary(req, res);
        break;
      case 'comments.csv':
        await handleGetCommentSummary(req, res);
        break;
      case 'votes.csv':
        await handleGetVotesSummary(req, res);
        break;
      case 'participant-votes.csv':
        await handleGetParticipantVotesSummary(req, res);
        break;
      case 'comment-groups.csv':
        await handleGetCommentGroupsSummary(req, res);
        break;
      default:
        fail(res, 404, 'polis_error_data_unknown_report');
        break;
    }
  } catch (err) {
    const msg = err?.message?.startsWith('polis_') ? err.message : 'polis_err_data_export';
    fail(res, 500, msg, err);
  }
};
