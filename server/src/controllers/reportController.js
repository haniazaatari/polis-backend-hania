import { sql_reports } from '../db/sql.js';
import {
  canModifyReportCommentSelections,
  createOrUpdateReportCommentSelection
} from '../services/report/reportCommentSelectionsService.js';
import { generateReportNarrative } from '../services/report/reportNarrativeService.js';
import {
  createReport,
  getReport,
  getReportsByConversation,
  getUserReports,
  processReportsForResponse,
  updateReportFields
} from '../services/report/reportService.js';
import logger from '../utils/logger.js';
import { fail } from '../utils/responseHandlers.js';

/**
 * Handle GET request for report narrative
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const handleReportNarrative = async (req, res) => {
  try {
    const { rid } = req.p;
    const modelParam = req.query.model || 'openai';
    const modelVersionParam = req.query.modelVersion;
    const noCache = req.query.noCache === 'true';

    // Set response headers for streaming
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked'
    });

    // Generate the report narrative
    await generateReportNarrative(rid, res, modelParam, modelVersionParam, noCache);

    // End the response
    res.end();
  } catch (err) {
    // If the response has already started, we need to end it
    if (res.headersSent) {
      res.end();
    }

    logger.error('Error handling report narrative:', err);

    const msg = err?.message?.startsWith('polis_') ? err.message : 'polis_err_report_narrative';

    fail(res, 500, msg, err);
  }
};

/**
 * Handle GET request for reports
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const handleGetReports = async (req, res) => {
  try {
    const { zid, rid, uid } = req.p;
    let reports = [];

    if (rid) {
      if (zid) {
        return fail(res, 400, 'polis_err_get_reports_should_not_specify_both_report_id_and_conversation_id');
      }
      reports = await getReport(rid);
      reports = [reports]; // Wrap in array for consistent processing
    } else if (zid) {
      reports = await getReportsByConversation(zid, uid);
    } else {
      reports = await getUserReports(uid);
    }

    const processedReports = await processReportsForResponse(reports);
    res.json(processedReports);
  } catch (err) {
    logger.error('Error handling GET reports:', err);

    if (err.message === 'polis_err_permissions') {
      return fail(res, 403, 'polis_err_permissions');
    }

    if (err.message === 'polis_err_get_reports_should_not_specify_both_report_id_and_conversation_id') {
      return fail(res, 404, 'polis_err_get_reports_should_not_specify_both_report_id_and_conversation_id');
    }

    return fail(res, 500, 'polis_err_get_reports_misc', err);
  }
};

/**
 * Handle POST request to create a report
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const handleCreateReport = async (req, res) => {
  try {
    const { zid } = req.p;
    await createReport(zid);
    res.json({});
  } catch (err) {
    logger.error('Error handling POST reports:', err);
    return fail(res, 500, 'polis_err_post_reports_misc', err);
  }
};

/**
 * Handle PUT request to update a report
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const handleUpdateReport = async (req, res) => {
  try {
    const { rid, uid, zid } = req.p;

    // Get all label columns from the reports table
    const labelColumns = sql_reports.columns.map((c) => c.name).filter((name) => name.startsWith('label_'));

    // Build the update fields object
    const updateFields = {};

    // Add label fields if they exist in the request
    for (const name of labelColumns) {
      if (req.p[name] !== undefined) {
        updateFields[name] = req.p[name];
      }
    }

    // Add report_name if it exists in the request
    if (req.p.report_name !== undefined) {
      updateFields.report_name = req.p.report_name;
    }

    await updateReportFields(zid, rid, uid, updateFields);
    res.json({});
  } catch (err) {
    logger.error('Error handling PUT reports:', err);

    if (err.message === 'polis_err_permissions') {
      return fail(res, 403, 'polis_err_put_reports_permissions', err);
    }

    return fail(res, 500, 'polis_err_post_reports_misc', err);
  }
};

/**
 * Handle POST request to update report comment selections
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handlePostReportCommentSelections(req, res) {
  try {
    const uid = req.p.uid;
    const zid = req.p.zid;
    const rid = req.p.rid;
    const tid = req.p.tid;
    const selection = req.p.include ? 1 : -1;

    // Check if user can modify report comment selections
    const canModify = await canModifyReportCommentSelections(zid, uid);
    if (!canModify) {
      return fail(res, 403, 'polis_err_POST_reportCommentSelections_auth');
    }

    // Create or update the selection
    await createOrUpdateReportCommentSelection(rid, tid, selection, zid);

    // Return success
    res.json({});
  } catch (err) {
    fail(res, 500, 'polis_err_POST_reportCommentSelections_misc', err);
  }
}

export {
  handleReportNarrative,
  handleGetReports,
  handleCreateReport,
  handleUpdateReport,
  handlePostReportCommentSelections
};
