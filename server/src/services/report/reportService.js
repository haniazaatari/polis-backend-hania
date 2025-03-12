import { isModerator } from '../../db/authorization.js';
import {
  createReport as createReportInDb,
  getReportById,
  getReportsByConversationId,
  getReportsByUserId,
  updateReport
} from '../../repositories/report/reportRepository.js';
import { generateRandomToken } from '../auth/tokenService.js';
import { getZinvite } from '../zinvite/zinviteService.js';

/**
 * Create a new report for a conversation
 * @param {number} zid - The conversation ID
 * @returns {Promise} - A promise that resolves when the report is created
 */
async function createReport(zid) {
  const token = await generateRandomToken(20, false);
  const report_id = `r${token}`;
  return createReportInDb(zid, report_id);
}

/**
 * Check if a user has permission to access a report
 * @param {number} zid - The conversation ID
 * @param {number} uid - The user ID
 * @returns {Promise<boolean>} - A promise that resolves with whether the user has permission
 */
async function hasReportPermission(zid, uid) {
  return isModerator(zid, uid);
}

/**
 * Get reports for a conversation
 * @param {number} zid - The conversation ID
 * @param {number} uid - The user ID
 * @returns {Promise<Array>} - A promise that resolves with the reports
 */
async function getReportsByConversation(zid, uid) {
  const hasPermission = await hasReportPermission(zid, uid);
  if (!hasPermission) {
    throw new Error('polis_err_permissions');
  }
  return getReportsByConversationId(zid);
}

/**
 * Get a report by its ID
 * @param {string} rid - The report ID
 * @returns {Promise<object>} - A promise that resolves with the report
 */
async function getReport(rid) {
  const reports = await getReportById(rid);
  if (!reports || reports.length === 0) {
    throw new Error('polis_err_report_not_found');
  }
  return reports[0];
}

/**
 * Get reports for a user
 * @param {number} uid - The user ID
 * @returns {Promise<Array>} - A promise that resolves with the reports
 */
async function getUserReports(uid) {
  return getReportsByUserId(uid);
}

/**
 * Update a report
 * @param {number} zid - The conversation ID
 * @param {string} rid - The report ID
 * @param {number} uid - The user ID
 * @param {object} updateFields - The fields to update
 * @returns {Promise} - A promise that resolves when the report is updated
 */
async function updateReportFields(zid, rid, uid, updateFields) {
  const hasPermission = await hasReportPermission(zid, uid);
  if (!hasPermission) {
    throw new Error('polis_err_permissions');
  }

  const fields = {
    modified: 'now_as_millis()'
  };

  // Copy the update fields to the fields object
  Object.assign(fields, updateFields);

  return updateReport(rid, fields);
}

/**
 * Process reports for response
 * @param {Array} reports - The reports to process
 * @returns {Promise<Array>} - A promise that resolves with the processed reports
 */
async function processReportsForResponse(reports) {
  if (!reports || reports.length === 0) {
    return [];
  }

  const zids = reports.map((report) => report.zid);
  const uniqueZids = [...new Set(zids)];

  if (uniqueZids.length === 0) {
    return reports.map((report) => {
      // Create a new object without the rid property
      const { rid, ...newReport } = report;
      return newReport;
    });
  }

  // Get zinvites for all zids
  const zinvitePromises = uniqueZids.map((zid) => getZinvite(zid));
  const zinviteResults = await Promise.all(zinvitePromises);

  // Create a map of zid to zinvite
  const zidToZinvite = {};
  uniqueZids.forEach((zid, index) => {
    zidToZinvite[zid] = zinviteResults[index];
  });

  // Process reports
  return reports.map((report) => {
    // Create a new object with only the properties we want
    const { rid, zid, ...newReport } = report;
    return {
      ...newReport,
      conversation_id: zidToZinvite[zid]
    };
  });
}

export {
  createReport,
  hasReportPermission,
  getReportsByConversation,
  getReport,
  getUserReports,
  updateReportFields,
  processReportsForResponse
};
