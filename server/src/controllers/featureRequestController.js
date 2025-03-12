import { sendFeatureRequest } from '../services/featureRequest/featureRequestService.js';
import logger from '../utils/logger.js';

/**
 * Handle GET request for dummy button feature request
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
function handleGetDummyButton(req, res) {
  const message = `${req.p.button} ${req.p.uid}`;

  sendFeatureRequest(message)
    .then(() => {
      res.status(200).end();
    })
    .catch((err) => {
      // Original implementation doesn't handle errors, so we'll just log them
      logger.error('Error sending feature request:', err);
      res.status(200).end(); // Still return 200 to match original behavior
    });
}

export { handleGetDummyButton };
