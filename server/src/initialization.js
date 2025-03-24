import Config from './config.js';
import { backfillCommentLanguageDetection } from './services/comment/commentLanguageService.js';
import { initializeApplicationServices } from './services/initialization/appInitializationService.js';
import { scheduleExportTests } from './services/scheduled/exportTestScheduler.js';
import logger from './utils/logger.js';

/**
 * Main application initialization function
 * This initializes all required services for the application
 */
function initializeApplication() {
  if (!Config.backfillCommentLangDetection) {
    return;
  }
  
  logger.debug('Starting application initialization');

  // Initialize core services
  initializeApplicationServices();

  // Initialize comment language detection backfill if enabled
  backfillCommentLanguageDetection();

  // Initialize export test scheduler if enabled
  scheduleExportTests();

  logger.debug('Application initialization complete');

  // No longer need to return middlewares as they're imported directly in app.js
}

export { initializeApplication };
