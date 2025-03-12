import crypto from 'crypto';
import logger from './logger.js';
import { paramsToStringSortedByName } from './parameter.js';

// The name of the HMAC signature parameter in query strings
export const HMAC_SIGNATURE_PARAM_NAME = 'signature';

// Secret key for HMAC - should be moved to config in production
const HMAC_SECRET = 'G7f387ylIll8yuskuf2373rNBmcxqWYFfHhdsd78f3uekfs77EOLR8wofw';

/**
 * Create an HMAC signature for query parameters
 * @param {string} path - The API path
 * @param {Object} params - The query parameters
 * @returns {string} - The HMAC signature
 */
export function createHmacForQueryParams(path, params) {
  const cleanPath = path.replace(/\/$/, '');
  const s = `${cleanPath}?${paramsToStringSortedByName(params)}`;
  const hmac = crypto.createHmac('sha1', HMAC_SECRET);
  hmac.setEncoding('hex');
  hmac.write(s);
  hmac.end();
  const hash = hmac.read();
  return hash;
}

/**
 * Verify an HMAC signature for query parameters
 * @param {string} path - The API path
 * @param {Object} params - The query parameters including the signature
 * @returns {Promise<void>} - Resolves if signature is valid, rejects if invalid
 */
export function verifyHmacForQueryParams(path, params) {
  return new Promise((resolve, reject) => {
    const clonedParams = { ...params };
    const hash = clonedParams[HMAC_SIGNATURE_PARAM_NAME];
    delete clonedParams[HMAC_SIGNATURE_PARAM_NAME];
    const correctHash = createHmacForQueryParams(path, clonedParams);
    setTimeout(() => {
      logger.debug('comparing', { correctHash, hash });
      if (correctHash === hash) {
        resolve();
      } else {
        reject();
      }
    }, 0);
  });
}
