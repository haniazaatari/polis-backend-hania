/**
 * Error handling middleware and utilities
 * Contains global error handlers and Express error middleware
 */

import logger from '../utils/logger.js';

/**
 * Set up global unhandled promise rejection handler
 * This prevents the server from crashing on unhandled promise rejections
 */
export function setupUnhandledRejectionHandler() {
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Promise Rejection:', { reason, promise });
    // Don't crash the server
  });
}

/**
 * Set up global uncaught exception handler
 * This prevents the server from crashing on certain types of database errors
 */
export function setupUncaughtExceptionHandler() {
  process.on('uncaughtException', (err) => {
    if (err?.code?.startsWith('23') && err?.constraint) {
      // Handle database constraint violations and other PostgreSQL errors
      logger.error('Uncaught PostgreSQL error:', {
        code: err.code,
        constraint: err.constraint,
        message: err.message,
        detail: err.detail
      });
      // Don't crash the server for database constraint errors
    } else {
      // For other types of errors, log them but still crash
      logger.error('Uncaught exception:', err);
      process.exit(1);
    }
  });
}

/**
 * Initialize all global error handlers
 * This is a convenience function to set up all error handlers at once
 */
export function initializeErrorHandlers() {
  setupUnhandledRejectionHandler();
  setupUncaughtExceptionHandler();
}

/**
 * Express error middleware
 * This should be added after all routes are defined
 * @param {Error} err - The error that was thrown
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 * @param {Function} next - Express next function
 */
export function errorMiddleware(err, req, res, next) {
  logger.error('Express error handler caught:', {
    error: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip
  });

  // Send appropriate status code based on error type
  if (err.status) {
    res.status(err.status).json({ error: err.message || 'Internal server error' });
  } else {
    res.status(500).json({ error: 'Internal server error' });
  }
}
