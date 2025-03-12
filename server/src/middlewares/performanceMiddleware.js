import responseTime from 'response-time';
import { addInRamMetric } from '../utils/metered.js';

/**
 * Middleware to track response time for routes
 * Adds metrics to in-memory storage for performance monitoring
 *
 * @returns {Function} - Express middleware function
 */
const responseTimeStart = responseTime((req, _res, time) => {
  // Only track metrics for defined routes
  if (req?.route?.path) {
    const path = req.route.path;
    const truncatedTime = Math.trunc(time);
    addInRamMetric(path, truncatedTime);
  }
});

export { responseTimeStart };
