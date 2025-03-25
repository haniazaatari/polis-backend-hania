import { escapeLiteral } from '../utils/common.js';
import { queryP, query_readOnly } from './pg-query.js';

/**
 * Retrieves XID mappings for a conversation
 * @param {number} zid - The conversation ID
 * @returns {Promise<Array>} - Array of pid to xid mappings
 */
async function getXids(zid) {
  return new Promise((resolve, reject) => {
    query_readOnly(
      'select pid, xid from xids inner join ' +
        '(select * from participants where zid = ($1)) as p on xids.uid = p.uid ' +
        ' where owner in (select org_id from conversations where zid = ($1));',
      [zid],
      (err, result) => {
        if (err) {
          reject('polis_err_fetching_xids');
          return;
        }
        resolve(result.rows);
      }
    );
  });
}

/**
 * Adds XID whitelist entries
 * @param {Array<string>} xid_whitelist - List of XIDs to whitelist
 * @param {number} owner - Owner ID
 * @returns {Promise} - Resolution of the query
 */
function addXidWhitelist(xid_whitelist, owner) {
  const entries = [];
  try {
    for (let i = 0; i < xid_whitelist.length; i++) {
      entries.push(`(${escapeLiteral(xid_whitelist[i])},${owner})`);
    }
  } catch (err) {
    return Promise.reject(err);
  }

  return queryP(`insert into xid_whitelist (xid, owner) values ${entries.join(',')} on conflict do nothing;`, []);
}

/**
 * Checks if a correlation matrix result exists for a report
 * @param {number} rid - Report ID
 * @param {string} math_env - Math environment
 * @param {number} math_tick - Math tick
 * @returns {Promise<Array>} - Rows of correlation matrix data
 */
function getCorrelationMatrix(rid, math_env, math_tick) {
  return queryP(
    'select * from math_report_correlationmatrix where rid = ($1) and math_env = ($2) and math_tick >= ($3);',
    [rid, math_env, math_tick]
  );
}

/**
 * Checks if a math task request exists
 * @param {number} rid - Report ID
 * @param {string} math_env - Math environment
 * @param {number} math_tick - Math tick
 * @returns {Promise<Array>} - Rows of worker tasks
 */
function checkMathTaskExists(rid, math_env, math_tick) {
  return queryP(
    "select * from worker_tasks where task_type = 'generate_report_data' and math_env=($2) " +
      'and task_bucket = ($1) ' +
      "and (task_data->>'math_tick')::int >= ($3) " +
      'and finished_time is NULL;',
    [rid, math_env, math_tick]
  );
}

/**
 * Checks if comment selections exist for a report
 * @param {number} rid - Report ID
 * @returns {Promise<boolean>} - True if selections exist
 */
function hasCommentSelections(rid) {
  return queryP('select * from report_comment_selections where rid = ($1) and selection = 1;', [rid]).then((rows) => {
    return rows.length > 0;
  });
}

/**
 * Creates a math update task
 * @param {number} zid - Conversation ID
 * @param {string} math_update_type - Type of math update
 * @param {string} math_env - Math environment
 * @returns {Promise} - Resolution of the query
 */
function createMathUpdateTask(zid, math_update_type, math_env) {
  return queryP(
    "insert into worker_tasks (task_type, task_data, task_bucket, math_env) values ('update_math', $1, $2, $3);",
    [
      JSON.stringify({
        zid: zid,
        math_update_type: math_update_type
      }),
      zid,
      math_env
    ]
  );
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
  return queryP(
    "insert into worker_tasks (task_type, task_data, task_bucket, math_env) values ('generate_report_data', $1, $2, $3);",
    [
      JSON.stringify({
        rid: rid,
        zid: zid,
        math_tick: math_tick
      }),
      rid,
      math_env
    ]
  );
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
