/**
 * Domain Utilities Module
 * Contains utility functions for working with domains
 */
import { checkDomainPattern, getDomainWhitelist } from '../../db/domains.js';
import logger from '../logger.js';

/**
 * Extracts domain from a referrer URL
 * @param {string} referrer - The referrer URL
 * @returns {string|null} - The extracted domain or null
 */
function extractDomainFromReferrer(referrer) {
  if (!referrer) {
    return null;
  }

  try {
    const url = new URL(referrer);
    return url.hostname.toLowerCase();
  } catch (e) {
    logger.warn('Error extracting domain from referrer', { error: e, referrer });
    return null;
  }
}

/**
 * Checks if a domain matches a pattern
 * @param {string} domain - The domain to check
 * @param {string} pattern - The pattern to match against
 * @returns {boolean} - True if domain matches pattern
 */
function domainMatchesPattern(domain, pattern) {
  return checkDomainPattern(domain, pattern);
}

/**
 * Checks if a domain is whitelisted
 * @param {string} domain - The domain to check
 * @returns {Promise<boolean>} - True if domain is whitelisted
 */
async function isDomainWhitelisted(domain) {
  try {
    const whitelist = await getDomainWhitelist();
    return whitelist.some((pattern) => domainMatchesPattern(domain, pattern));
  } catch (error) {
    logger.error('Error checking domain whitelist', { error, domain });
    return false;
  }
}

/**
 * Checks if a parent domain is whitelisted
 * @param {string} domain - The domain to check
 * @returns {Promise<boolean>} - True if parent domain is whitelisted
 */
async function isParentDomainWhitelisted(domain) {
  try {
    const parts = domain.split('.');
    for (let i = 0; i < parts.length - 1; i++) {
      const parentDomain = parts.slice(i).join('.');
      if (await isDomainWhitelisted(parentDomain)) {
        return true;
      }
    }
    return false;
  } catch (error) {
    logger.error('Error checking parent domain whitelist', { error, domain });
    return false;
  }
}

export { extractDomainFromReferrer, domainMatchesPattern, isDomainWhitelisted, isParentDomainWhitelisted };
