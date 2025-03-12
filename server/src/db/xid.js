import logger from '../utils/logger.js';
import { pgQueryP_readOnly } from './pg-query.js';

/**
 * Get XID information for a user in a conversation
 * @param {string} xid - The external ID
 * @param {number} zid - The conversation ID
 * @returns {Promise<Object|string>} - The XID information or 'noXidRecord' if not found
 */
async function getXidStuff(xid, zid) {
  try {
    const rows = await pgQueryP_readOnly('SELECT * FROM xids WHERE xid = $1 AND zid = $2;', [xid, zid]);

    if (!rows?.length) {
      return 'noXidRecord';
    }

    return {
      uid: rows[0].uid,
      pid: rows[0].pid
    };
  } catch (err) {
    logger.error('Error in getXidStuff', err);
    return 'noXidRecord';
  }
}

export { getXidStuff };
