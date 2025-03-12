/**
 * Domain Middleware
 * Handles domain-related middleware functions
 */
import { extractDomainFromReferrer, isParentDomainWhitelisted } from '../utils/domain/domainUtils.js';
import logger from '../utils/logger.js';
import { fail } from '../utils/responseHandlers.js';

/**
 * Middleware to deny requests not from whitelisted domains
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function denyIfNotFromWhitelistedDomain(req, res, next) {
  // Skip if no conversation ID
  if (!req.p?.zid) {
    return next();
  }

  try {
    // Extract domain and iframe status from referrer
    const { domain, isWithinIframe } = extractDomainFromReferrer(req);

    // Check if domain is whitelisted
    const isWhitelisted = await isParentDomainWhitelisted(
      domain,
      req.p.zid,
      isWithinIframe,
      req.p.domain_whitelist_override_key
    );

    if (isWhitelisted) {
      return next();
    }

    // Log and fail if domain is not whitelisted
    logger.warn(`Domain not whitelisted: ${domain} for conversation: ${req.p.zid}`);
    fail(res, 403, 'polis_err_domain');
  } catch (err) {
    // Log and fail on error
    logger.error('Error checking domain whitelist', { error: err });
    fail(res, 500, 'polis_err_domain_check');
  }
}

export { denyIfNotFromWhitelistedDomain };
