import Config from './config.js';
import { backfillCommentLanguageDetection } from './services/comment/commentLanguageService.js';
import { initializeApplicationServices } from './services/initialization/appInitializationService.js';
import { scheduleExportTests } from './services/scheduled/exportTestScheduler.js';
import logger from './utils/logger.js';

/**
 * Initialize source map support for better error stack traces
 */
async function initializeSourceMapSupport() {
  try {
    const sourceMapSupport = await import('source-map-support');
    sourceMapSupport.install();
    logger.debug('Source map support initialized');
  } catch (err) {
    logger.error('Failed to initialize source map support:', err);
  }
}

/**
 * Main application initialization function
 * This initializes all required services for the application
 */
async function initializeApplication() {
  logger.debug('Starting application initialization');

  // Initialize source map support first for better error reporting
  await initializeSourceMapSupport();

  // Initialize core services
  initializeApplicationServices();

  // Initialize comment language detection backfill if enabled
  if (Config.backfillCommentLangDetection) {
    backfillCommentLanguageDetection();
  }

  // Initialize export test scheduler if enabled
  scheduleExportTests();

  logger.debug('Application initialization complete');

  // No longer need to return middlewares as they're imported directly in app.js
}

export { initializeApplication };
