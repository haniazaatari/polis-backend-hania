/**
 * Domain Utilities
 * Utility functions for domain-related operations
 */
import { queryP_readOnly } from '../../db/pg-query.js';
import logger from '../logger.js';

/**
 * Check if a domain matches a pattern, handling wildcards
 * @param {string} domain - The domain to check
 * @param {string} pattern - The pattern to match against
 * @returns {boolean} - Whether the domain matches the pattern
 */
function domainMatchesPattern(domain, pattern) {
  // No domain or pattern means no match
  if (!domain || !pattern) {
    return false;
  }

  const domainParts = domain.split('.');
  const patternParts = pattern.split('.');

  // Handle wildcard pattern (e.g., *.example.com)
  if (patternParts[0] === '*') {
    // If pattern is just "*", it matches everything
    if (patternParts.length === 1) {
      return true;
    }

    // For patterns like *.example.com, compare from right to left
    // The domain must end with the pattern after the wildcard
    const patternSuffix = patternParts.slice(1);
    const domainSuffix = domainParts.slice(-patternSuffix.length);

    // If domain doesn't have enough parts, it can't match
    if (domainSuffix.length !== patternSuffix.length) {
      return false;
    }

    // Compare each part
    return patternSuffix.every((part, index) => part === domainSuffix[index]);
  }

  // For exact matches, domains must have the same number of parts
  if (domainParts.length !== patternParts.length) {
    return false;
  }

  // Compare each part
  return patternParts.every((part, index) => part === domainParts[index]);
}

/**
 * Check if a parent domain is whitelisted for a conversation
 * @param {string} domain - The domain to check
 * @param {number} zid - Conversation ID
 * @param {boolean} isWithinIframe - Whether the request is within an iframe
 * @param {string} [domain_whitelist_override_key] - Override key for domain whitelist
 * @returns {Promise<boolean>} - Whether the domain is whitelisted
 */
async function isParentDomainWhitelisted(domain, zid, isWithinIframe, domain_whitelist_override_key) {
  try {
    const rows = await queryP_readOnly(
      'select * from site_domain_whitelist where site_id = ' +
        '(select site_id from users where uid = ' +
        '(select owner from conversations where zid = ($1)));',
      [zid]
    );

    logger.debug('isParentDomainWhitelisted', {
      domain,
      zid,
      isWithinIframe
    });

    // If no whitelist exists, allow all domains
    if (!rows?.length || !rows[0].domain_whitelist?.length) {
      logger.debug('isParentDomainWhitelisted : no whitelist');
      return true;
    }

    const whitelist = rows[0].domain_whitelist;
    const whitelistedDomains = whitelist.split(',');

    // Allow *.pol.is if not within iframe
    if (!isWithinIframe && whitelistedDomains.includes('*.pol.is')) {
      logger.debug('isParentDomainWhitelisted : *.pol.is');
      return true;
    }

    // Allow if override key matches
    if (domain_whitelist_override_key && rows[0].domain_whitelist_override_key === domain_whitelist_override_key) {
      return true;
    }

    // Check if domain matches any pattern in the whitelist
    const isWhitelisted = whitelistedDomains.some((pattern) => domainMatchesPattern(domain, pattern));

    logger.debug(`isParentDomainWhitelisted : ${isWhitelisted}`);
    return isWhitelisted;
  } catch (err) {
    logger.error('Error in isParentDomainWhitelisted', { error: err });
    throw err;
  }
}

/**
 * Extract domain from referrer
 * @param {Object} req - Express request object
 * @returns {Object} - Object containing domain and isWithinIframe flag
 */
function extractDomainFromReferrer(req) {
  const referrer = req.headers.referer || req.headers.referrer || '';
  const isWithinIframe = referrer?.includes('parent_url') || req.headers['x-polis-iframe'] === 'true';

  let domain = '';

  if (isWithinIframe && referrer) {
    // Extract domain from parent_url parameter in referrer
    try {
      const parentUrlMatch = referrer.match(/parent_url=([^&]+)/);
      if (parentUrlMatch) {
        const decodedUrl = decodeURIComponent(parentUrlMatch[1]);
        const urlObj = new URL(decodedUrl);
        domain = urlObj.hostname;
      }
    } catch (err) {
      logger.debug('Error parsing parent_url', { error: err, referrer });
    }
  } else if (referrer) {
    // Extract domain directly from referrer
    try {
      const urlObj = new URL(referrer);
      domain = urlObj.hostname;
    } catch (err) {
      logger.debug('Error parsing referrer', { error: err, referrer });
    }
  }

  return {
    domain,
    isWithinIframe
  };
}

export { isParentDomainWhitelisted, extractDomainFromReferrer, domainMatchesPattern };
