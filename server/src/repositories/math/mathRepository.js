import {
  addXidWhitelist as dbAddXidWhitelist,
  checkMathTaskExists as dbCheckMathTaskExists,
  createMathUpdateTask as dbCreateMathUpdateTask,
  createReportDataTask as dbCreateReportDataTask,
  getCorrelationMatrix as dbGetCorrelationMatrix,
  getXids as dbGetXids,
  hasCommentSelections as dbHasCommentSelections
} from '../../db/math.js';

/**
 * Retrieves XID mappings for a conversation
 * @param {number} zid - The conversation ID
 * @returns {Promise<Array>} - Array of pid to xid mappings
 */
function getXids(zid) {
  return dbGetXids(zid);
}

/**
 * Adds XID whitelist entries
 * @param {Array<string>} xid_whitelist - List of XIDs to whitelist
 * @param {number} owner - Owner ID
 * @returns {Promise} - Resolution of the query
 */
function addXidWhitelist(xid_whitelist, owner) {
  return dbAddXidWhitelist(xid_whitelist, owner);
}

/**
 * Checks if a correlation matrix result exists for a report
 * @param {number} rid - Report ID
 * @param {string} math_env - Math environment
 * @param {number} math_tick - Math tick
 * @returns {Promise<Array>} - Rows of correlation matrix data
 */
function getCorrelationMatrix(rid, math_env, math_tick) {
  return dbGetCorrelationMatrix(rid, math_env, math_tick);
}

/**
 * Checks if a math task request exists
 * @param {number} rid - Report ID
 * @param {string} math_env - Math environment
 * @param {number} math_tick - Math tick
 * @returns {Promise<Array>} - Rows of worker tasks
 */
function checkMathTaskExists(rid, math_env, math_tick) {
  return dbCheckMathTaskExists(rid, math_env, math_tick);
}

/**
 * Checks if comment selections exist for a report
 * @param {number} rid - Report ID
 * @returns {Promise<boolean>} - True if selections exist
 */
function hasCommentSelections(rid) {
  return dbHasCommentSelections(rid);
}

/**
 * Creates a math update task
 * @param {number} zid - Conversation ID
 * @param {string} math_update_type - Type of math update
 * @param {string} math_env - Math environment
 * @returns {Promise} - Resolution of the query
 */
function createMathUpdateTask(zid, math_update_type, math_env) {
  return dbCreateMathUpdateTask(zid, math_update_type, math_env);
}

/**
 * Creates a report data generation task
 * @param {number} rid - Report ID
 * @param {number} zid - Conversation ID
 * @param {number} math_tick - Math tick
 * @param {string} math_env - Math environment
 * @returns {Promise} - Resolution of the query
 */
function createReportDataTask(rid, zid, math_tick, math_env) {
  return dbCreateReportDataTask(rid, zid, math_tick, math_env);
}

export {
  getXids,
  addXidWhitelist,
  getCorrelationMatrix,
  checkMathTaskExists,
  hasCommentSelections,
  createMathUpdateTask,
  createReportDataTask
};
