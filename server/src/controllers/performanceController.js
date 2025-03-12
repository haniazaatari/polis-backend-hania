import { getPerformanceStats } from '../services/performance/performanceService.js';

/**
 * Handle GET request for performance statistics
 * @param {Object} _req - Express request object (unused)
 * @param {Object} res - Express response object
 */
function handleGetPerfStats(_req, res) {
  const stats = getPerformanceStats();
  res.json(stats);
}

export { handleGetPerfStats };
