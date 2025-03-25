import { isModerator } from '../../db/authorization.js';
import { createOrUpdateSelection, deleteCorrelationMatrix } from '../../db/reportCommentSelections.js';

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
  await createOrUpdateSelection(rid, tid, selection, zid);

  // Delete any existing correlation matrix for this report
  await deleteCorrelationMatrix(rid);
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
