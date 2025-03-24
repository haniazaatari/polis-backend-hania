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
    ip: req.ip,
    method: req.method,
    url: req.url
  });

  // Don't modify the response if headers have already been sent
  if (res.headersSent) {
    return next(err);
  }

  // If the response has a status code set, use that
  const statusCode = res.statusCode !== 200 ? res.statusCode : 500;

  // For compatibility with legacy code, handle string errors specially
  if (typeof err === 'string' && err.startsWith('polis_err_')) {
    logger.warn(`errorMiddleware: string error ${statusCode}`, { err });
    // return res.status(statusCode).send(err);
  }

  // If the error has a status property, use that
  if (err.status) {
    logger.warn(`errorMiddleware: status error ${statusCode}`, { err });
    // return res.status(err.status).send(err.message || 'Internal server error');
  }

  // Default to 500 with the error message
  logger.warn(`errorMiddleware: default error ${statusCode}`, { err });
  // res.status(statusCode).send(err.message || 'Internal server error');
  return next(err);
}
