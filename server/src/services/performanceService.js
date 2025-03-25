import { METRICS_IN_RAM } from '../../utils/metered.js';

/**
 * Get performance statistics from in-memory metrics
 * @returns {Object} - Performance metrics
 */
function getPerformanceStats() {
  return METRICS_IN_RAM;
}

export { getPerformanceStats };
