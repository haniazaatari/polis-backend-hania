import { queryP_readOnly, stream_queryP_readOnly } from './pg-query.js';

/**
 * Get conversation metadata
 * @param {number} zid - Conversation ID
 * @returns {Promise<Array>} Conversation records
 */
async function getConversationMetadata(zid) {
  return await queryP_readOnly('SELECT topic, description FROM conversations WHERE zid = $1', [zid]);
}

/**
 * Get commenter count
 * @param {number} zid - Conversation ID
 * @returns {Promise<Array>} Count records
 */
async function getCommenterCount(zid) {
  return await queryP_readOnly('SELECT COUNT(DISTINCT pid) FROM comments WHERE zid = $1', [zid]);
}

/**
 * Get comments for export
 * @param {number} zid - Conversation ID
 * @returns {Promise<Array>} Comment records
 */
async function getCommentsForExport(zid) {
  return await queryP_readOnly('SELECT tid, pid, created, txt, mod, velocity, active FROM comments WHERE zid = ($1)', [
    zid
  ]);
}

/**
 * Stream votes for export
 * @param {number} zid - Conversation ID
 * @param {Function} rowCallback - Callback for each row
 * @param {Function} endCallback - Callback when done
 * @param {Function} errorCallback - Callback for errors
 */
function streamVotesForExport(zid, rowCallback, endCallback, errorCallback) {
  stream_queryP_readOnly(
    'SELECT tid, vote FROM votes WHERE zid = ($1) ORDER BY tid',
    [zid],
    rowCallback,
    endCallback,
    errorCallback
  );
}

/**
 * Stream participant votes for export
 * @param {number} zid - Conversation ID
 * @param {Function} rowCallback - Callback for each row
 * @param {Function} endCallback - Callback when done
 * @param {Function} errorCallback - Callback for errors
 */
function streamParticipantVotesForExport(zid, rowCallback, endCallback, errorCallback) {
  stream_queryP_readOnly(
    'SELECT pid, tid, vote FROM votes WHERE zid = ($1) ORDER BY pid, tid',
    [zid],
    rowCallback,
    endCallback,
    errorCallback
  );
}

/**
 * Get comments for group export
 * @param {number} zid - Conversation ID
 * @returns {Promise<Array>} Comment records
 */
async function getCommentsForGroupExport(zid) {
  return await queryP_readOnly('SELECT tid, txt FROM comments WHERE zid = ($1)', [zid]);
}

export {
  getConversationMetadata,
  getCommenterCount,
  getCommentsForExport,
  streamVotesForExport,
  streamParticipantVotesForExport,
  getCommentsForGroupExport
};
