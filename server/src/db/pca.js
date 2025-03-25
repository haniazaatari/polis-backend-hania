import logger from '../utils/logger.js';
/**
 * PCA Database Module
 * Contains database functions for PCA operations
 */
import { queryP_readOnly } from './pg-query.js';

/**
 * Gets PCA data for a conversation
 * @param {number} zid - Conversation ID
 * @param {string} mathEnv - Math environment
 * @returns {Promise<Object|null>} - PCA data or null if not found
 */
async function getPcaData(zid, mathEnv) {
  try {
    let query = 'select * from math_main where math_env = ($1)';
    const params = [mathEnv];

    if (zid !== null) {
      query += ' and zid = ($2)';
      params.push(zid);
    } else {
      query += ' and caching_tick > ($2) order by caching_tick limit 10';
      params.push(-1);
    }

    const rows = await queryP_readOnly(query, params);

    if (!rows || !rows.length) {
      return null;
    }

    const item = rows[0].data;
    if (rows[0].math_tick) {
      item.math_tick = Number(rows[0].math_tick);
    }
    if (rows[0].caching_tick) {
      item.caching_tick = Number(rows[0].caching_tick);
    }
    item.zid = rows[0].zid;

    return item;
  } catch (error) {
    logger.error('Error getting PCA data', { error, zid, mathEnv });
    throw error;
  }
}

/**
 * Get latest cached PCA data
 * @param {number} lastPrefetchedMathTick - Last prefetched math tick
 * @returns {Promise<Array>} - Array of PCA data items
 */
async function getLatestCachedPcaData(lastPrefetchedMathTick) {
  return queryP_readOnly('select * from math_main where caching_tick > ($1) order by caching_tick limit 10;', [
    lastPrefetchedMathTick
  ]);
}

export { getPcaData, getLatestCachedPcaData };
