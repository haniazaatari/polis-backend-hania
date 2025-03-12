import { isModerator } from '../../db/authorization.js';
import { queryP } from '../../db/pg-query.js';

/**
 * Create or update a report comment selection
 * @param {number} rid - Report ID
 * @param {number} tid - Comment ID
 * @param {number} selection - Selection value (1 for include, -1 for exclude)
 * @param {number} zid - Conversation ID
 * @returns {Promise<void>} - Resolves when the selection is created or updated
 */
async function createOrUpdateReportCommentSelection(rid, tid, selection, zid) {
  // Insert or update the selection
  await queryP(
    'insert into report_comment_selections (rid, tid, selection, zid, modified) values ($1, $2, $3, $4, now_as_millis()) ' +
      'on conflict (rid, tid) do update set selection = ($3), zid = ($4), modified = now_as_millis();',
    [rid, tid, selection, zid]
  );

  // Delete any existing correlation matrix for this report
  await queryP('delete from math_report_correlationmatrix where rid = ($1);', [rid]);
}

/**
 * Check if a user can modify report comment selections
 * @param {number} zid - Conversation ID
 * @param {number} uid - User ID
 * @returns {Promise<boolean>} - Resolves with true if the user can modify selections
 */
async function canModifyReportCommentSelections(zid, uid) {
  return isModerator(zid, uid);
}

export { createOrUpdateReportCommentSelection, canModifyReportCommentSelections };
