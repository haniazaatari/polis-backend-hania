import {
  createReport as dbCreateReport,
  getReportById as dbGetReportById,
  getReportsByConversationId as dbGetReportsByConversationId,
  getReportsByUserId as dbGetReportsByUserId,
  getZidForRid as dbGetZidForRid,
  updateReport as dbUpdateReport
} from '../../db/reports.js';

/**
 * Create a new report for a conversation
 * @param {number} zid - The conversation ID
 * @param {string} report_id - The report ID
 * @returns {Promise} - A promise that resolves when the report is created
 */
async function createReport(zid, report_id) {
  return dbCreateReport(zid, report_id);
}

/**
 * Get reports for a conversation
 * @param {number} zid - The conversation ID
 * @returns {Promise<Array>} - A promise that resolves with the reports
 */
async function getReportsByConversationId(zid) {
  return dbGetReportsByConversationId(zid);
}

/**
 * Get a report by its ID
 * @param {string} rid - The report ID
 * @returns {Promise<Array>} - A promise that resolves with the report
 */
async function getReportById(rid) {
  return dbGetReportById(rid);
}

/**
 * Get reports for a user
 * @param {number} uid - The user ID
 * @returns {Promise<Array>} - A promise that resolves with the reports
 */
async function getReportsByUserId(uid) {
  return dbGetReportsByUserId(uid);
}

/**
 * Update a report
 * @param {string} rid - The report ID
 * @param {object} fields - The fields to update
 * @returns {Promise} - A promise that resolves when the report is updated
 */
async function updateReport(rid, fields) {
  return dbUpdateReport(rid, fields);
}

/**
 * Get the conversation ID for a report ID
 * @param {string} rid - Report ID
 * @returns {Promise<number|null>} - Conversation ID or null if not found
 */
async function getZidForRid(rid) {
  return dbGetZidForRid(rid);
}

export { createReport, getReportsByConversationId, getReportById, getReportsByUserId, updateReport, getZidForRid };
