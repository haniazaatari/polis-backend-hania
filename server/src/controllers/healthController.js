import { testDatabaseConnection } from '../services/health/healthService.js';
import { fail } from '../utils/responseHandlers.js';

/**
 * Handle GET request to test API connection
 * @param {Object} _req - Express request object (unused)
 * @param {Object} res - Express response object
 */
function handleGetTestConnection(_req, res) {
  res.status(200).json({
    status: 'ok'
  });
}

/**
 * Handle GET request to test database connection
 * @param {Object} _req - Express request object (unused)
 * @param {Object} res - Express response object
 */
function handleGetTestDatabase(_req, res) {
  testDatabaseConnection()
    .then(() => {
      res.status(200).json({
        status: 'ok'
      });
    })
    .catch((err) => {
      fail(res, 500, 'polis_err_testDatabase', err);
    });
}

export { handleGetTestConnection, handleGetTestDatabase };
