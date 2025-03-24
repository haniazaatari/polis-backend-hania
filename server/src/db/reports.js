import { pgQueryP_readOnly } from './pg-query.js';

/**
 * Get comment selections for a specific report
 * @param {number} rid - The report ID
 * @returns {Promise<Array>} - Array of comment selection objects
 */
async function getReportCommentSelections(rid) {
  const selections = await pgQueryP_readOnly('SELECT tid, selection FROM report_comment_selections WHERE rid = ($1);', [
    rid
  ]);
  return selections;
}

export { getReportCommentSelections };
