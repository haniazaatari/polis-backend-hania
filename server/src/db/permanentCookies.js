import logger from '../utils/logger.js';
import { queryP } from './pg-query.js';

/**
 * Record a join between a permanent cookie and a conversation
 * @param {string} permanentCookieToken - Permanent cookie token
 * @param {number} zid - Conversation ID
 * @returns {Promise<void>}
 */
async function recordPermanentCookieZidJoin(permanentCookieToken, zid) {
  try {
    // Check if the join already exists
    const rows = await queryP('SELECT zid FROM permanentCookieZidJoins WHERE cookie = ($1) AND zid = ($2);', [
      permanentCookieToken,
      zid
    ]);

    // If the join doesn't exist, insert it
    if (!rows || !rows.length) {
      await queryP('INSERT INTO permanentCookieZidJoins (cookie, zid) VALUES ($1, $2);', [permanentCookieToken, zid]);
    }
  } catch (error) {
    logger.error('Error in recordPermanentCookieZidJoin', error);
    // Try to insert anyway in case the error was in the select query
    try {
      await queryP('INSERT INTO permanentCookieZidJoins (cookie, zid) VALUES ($1, $2);', [permanentCookieToken, zid]);
    } catch (insertError) {
      logger.error('Error inserting permanent cookie zid join', insertError);
      throw insertError;
    }
  }
}

export { recordPermanentCookieZidJoin };
