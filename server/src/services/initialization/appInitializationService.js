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
      logger.debug('Akismet: API key successfully verified.');
    } else {
      logger.debug('Akismet: Unable to verify API key.');
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
 * Adds a hashCode method to the String prototype
 * This should be used carefully as extending native prototypes can cause conflicts
 */
export function extendStringPrototype() {
  if (!String.prototype.hashCode) {
    String.prototype.hashCode = function () {
      let hash = 0;
      let i;
      let character;
      if (this.length === 0) {
        return hash;
      }
      for (i = 0; i < this.length; i++) {
        character = this.charCodeAt(i);
        hash = (hash << 5) - hash + character;
        hash = hash & hash;
      }
      return hash;
    };
  }
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
  extendStringPrototype();
  initializePcaDataCache();

  logger.debug('Application service initialization complete');
}
