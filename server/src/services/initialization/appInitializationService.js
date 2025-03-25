import akismetLib from 'akismet';
import AWS from 'aws-sdk';
import Config from '../../config.js';
import logger from '../../utils/logger.js';
import { fetchAndCacheLatestPcaData } from '../../utils/pca.js';

/**
 * Initializes the Akismet anti-spam service
 */
export function initializeAkismet() {
  const serverUrl = Config.getServerNameWithProtocol();

  const akismet = akismetLib.client({
    blog: serverUrl,
    apiKey: Config.akismetAntispamApiKey
  });

  akismet.verifyKey((_err, verified) => {
    if (verified) {
      logger.silly('Akismet: API key successfully verified.');
    } else {
      logger.silly('Akismet: Unable to verify API key.');
    }
  });

  return akismet;
}

/**
 * Initializes AWS configuration
 */
export function initializeAWS() {
  AWS.config.update({ region: Config.awsRegion });
}

/**
 * Initializes PCA data caching
 */
export function initializePcaDataCache() {
  fetchAndCacheLatestPcaData();
}

/**
 * Initializes all application services
 */
export function initializeApplicationServices() {
  logger.debug('Starting application service initialization');

  initializeAWS();
  initializeAkismet();
  initializePcaDataCache();

  logger.debug('Application service initialization complete');
}
