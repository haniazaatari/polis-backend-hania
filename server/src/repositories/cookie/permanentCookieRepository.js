import { recordPermanentCookieZidJoin as dbRecordPermanentCookieZidJoin } from '../../db/permanentCookies.js';

/**
 * Record a join between a permanent cookie and a conversation
 * @param {string} permanentCookieToken - Permanent cookie token
 * @param {number} zid - Conversation ID
 * @returns {Promise<void>}
 */
async function recordPermanentCookieZidJoin(permanentCookieToken, zid) {
  return dbRecordPermanentCookieZidJoin(permanentCookieToken, zid);
}

export { recordPermanentCookieZidJoin };
