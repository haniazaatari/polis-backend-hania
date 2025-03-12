import { COOKIES } from '../services/auth/constants.js';
import { recordMetrics } from '../services/metrics/metricsService.js';
import { fail } from '../utils/responseHandlers.js';

/**
 * Handle POST request to record metrics
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
function handlePostMetrics(req, res) {
  const enabled = false;
  if (!enabled) {
    return res.status(200).json({});
  }

  const uid = req.p.uid || null;
  const types = req.p.types;
  const durs = req.p.durs;
  const clientTimestamp = req.p.clientTimestamp;
  const permanentCookie = req.cookies[COOKIES.PERMANENT_COOKIE];

  recordMetrics(uid, types, durs, clientTimestamp, permanentCookie)
    .then(() => {
      res.json({});
    })
    .catch((err) => {
      fail(res, 500, 'polis_err_metrics_post', err);
    });
}

export { handlePostMetrics };
