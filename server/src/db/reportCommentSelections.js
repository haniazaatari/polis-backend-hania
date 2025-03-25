import { queryP } from './pg-query.js';

/**
 * Create or update a report comment selection
 * @param {number} rid - Report ID
 * @param {number} tid - Comment ID
 * @param {number} selection - Selection value (1 for include, -1 for exclude)
 * @param {number} zid - Conversation ID
 * @returns {Promise<void>}
 */
async function createOrUpdateSelection(rid, tid, selection, zid) {
  await queryP(
    'insert into report_comment_selections (rid, tid, selection, zid, modified) values ($1, $2, $3, $4, now_as_millis()) ' +
      'on conflict (rid, tid) do update set selection = ($3), zid = ($4), modified = now_as_millis();',
    [rid, tid, selection, zid]
  );
}

/**
 * Delete correlation matrix for a report
 * @param {number} rid - Report ID
 * @returns {Promise<void>}
 */
async function deleteCorrelationMatrix(rid) {
  await queryP('delete from math_report_correlationmatrix where rid = ($1);', [rid]);
}

export { createOrUpdateSelection, deleteCorrelationMatrix };
