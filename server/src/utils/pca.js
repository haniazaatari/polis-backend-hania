/**
 * PCA Utility Module
 * Contains utility functions for working with PCA data
 */
import Config from '../config.js';
import { getPcaData } from '../db/pca.js';
import logger from './logger.js';

// Cache for PCA results
const pcaCache = new Map();
let lastPrefetchedMathTick = -1;

/**
 * Gets PCA data for a conversation
 * @param {number} zid - Conversation ID
 * @param {number} [math_tick=-1] - Math tick for caching
 * @returns {Promise<Object|Error>} - PCA data or error
 */
async function getPca(zid, math_tick = -1) {
  try {
    // Check cache first
    if (pcaCache.has(zid) && pcaCache.get(zid).asPOJO.math_tick > math_tick) {
      return pcaCache.get(zid);
    }

    // Get fresh data from database
    const data = await getPcaData(zid, Config.mathEnv);

    if (!data) {
      return new Error('polis_err_get_pca_results_missing');
    }

    if (data.math_tick <= math_tick) {
      return new Error('polis_err_get_pca_results_not_new');
    }

    // Cache the results
    pcaCache.set(zid, {
      asPOJO: data,
      zid: zid,
      math_tick: data.math_tick
    });

    return pcaCache.get(zid);
  } catch (error) {
    logger.error('Error getting PCA data', { error, zid, math_tick });
    throw error;
  }
}

/**
 * Fetches and caches latest PCA data periodically
 */
function fetchAndCacheLatestPcaData() {
  let lastPrefetchPollStartTime = Date.now();

  function waitTime() {
    const timePassed = Date.now() - lastPrefetchPollStartTime;
    return Math.max(0, 2500 - timePassed);
  }

  async function pollForLatestPcaData() {
    try {
      lastPrefetchPollStartTime = Date.now();
      const data = await getPcaData(null, Config.mathEnv);

      if (!data) {
        logger.silly('mathpoll done');
        setTimeout(pollForLatestPcaData, waitTime());
        return;
      }

      if (data.caching_tick > lastPrefetchedMathTick) {
        lastPrefetchedMathTick = data.caching_tick;
      }

      // Cache the results
      pcaCache.set(data.zid, {
        asPOJO: data,
        zid: data.zid,
        math_tick: data.math_tick
      });

      setTimeout(pollForLatestPcaData, waitTime());
    } catch (error) {
      logger.error('mathpoll error', error);
      setTimeout(pollForLatestPcaData, waitTime());
    }
  }

  pollForLatestPcaData();
}

export { getPca, fetchAndCacheLatestPcaData };
