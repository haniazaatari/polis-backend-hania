import { queryP, queryP_readOnly } from './pg-query.js';
import { sql_reports } from './sql.js';

/**
 * Get comment selections for a specific report
 * @param {number} rid - The report ID
 * @returns {Promise<Array>} - Array of comment selection objects
 */
async function getReportCommentSelections(rid) {
  const selections = await queryP_readOnly('SELECT tid, selection FROM report_comment_selections WHERE rid = ($1);', [
    rid
  ]);
  return selections;
}

/**
 * Create a new report for a conversation
 * @param {number} zid - The conversation ID
 * @param {string} report_id - The report ID
 * @returns {Promise} - A promise that resolves when the report is created
 */
async function createReport(zid, report_id) {
  return queryP('insert into reports (zid, report_id) values ($1, $2);', [zid, report_id]);
}

/**
 * Get reports for a conversation
 * @param {number} zid - The conversation ID
 * @returns {Promise<Array>} - A promise that resolves with the reports
 */
async function getReportsByConversationId(zid) {
  return queryP('select * from reports where zid = ($1);', [zid]);
}

/**
 * Get a report by its ID
 * @param {string} rid - The report ID
 * @returns {Promise<Array>} - A promise that resolves with the report
 */
async function getReportById(rid) {
  return queryP('select * from reports where rid = ($1);', [rid]);
}

/**
 * Get reports for a user
 * @param {number} uid - The user ID
 * @returns {Promise<Array>} - A promise that resolves with the reports
 */
async function getReportsByUserId(uid) {
  return queryP('select * from reports where zid in (select zid from conversations where owner = ($1));', [uid]);
}

/**
 * Update a report
 * @param {string} rid - The report ID
 * @param {object} fields - The fields to update
 * @returns {Promise} - A promise that resolves when the report is updated
 */
async function updateReport(rid, fields) {
  const q = sql_reports.update(fields).where(sql_reports.rid.equals(rid));
  let query = q.toString();

  // Replace 'now_as_millis()' string with the actual function call
  if (fields.modified === 'now_as_millis()') {
    query = query.replace("'now_as_millis()'", 'now_as_millis()');
  }

  return queryP(query, []);
}

/**
 * Get the conversation ID for a report ID
 * @param {string} rid - Report ID
 * @returns {Promise<number|null>} - Conversation ID or null if not found
 */
async function getZidForRid(rid) {
  const rows = await queryP('SELECT zid FROM reports WHERE rid = ($1);', [rid]);
  if (!rows || !rows.length) {
    return null;
  }
  return rows[0].zid;
}

export {
  createReport,
  getReportsByConversationId,
  getReportById,
  getReportsByUserId,
  updateReport,
  getZidForRid,
  getReportCommentSelections
};
