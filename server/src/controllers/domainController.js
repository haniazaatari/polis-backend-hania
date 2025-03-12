/**
 * Domain Controller
 * Handles HTTP requests related to domains
 */
import { getDomainWhitelist, setDomainWhitelist } from '../services/domain/domainService.js';
import logger from '../utils/logger.js';
import { fail } from '../utils/responseHandlers.js';

/**
 * Handle GET request for domain whitelist
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleGetDomainWhitelist(req, res) {
  try {
    const uid = req.p.uid;
    const whitelist = await getDomainWhitelist(uid);

    res.json({
      domain_whitelist: whitelist
    });
  } catch (err) {
    logger.error('Error getting domain whitelist', { error: err, uid: req.p.uid });
    fail(res, 500, 'polis_err_get_domainWhitelist_misc', err);
  }
}

/**
 * Handle POST request to update domain whitelist
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handlePostDomainWhitelist(req, res) {
  try {
    const uid = req.p.uid;
    const domainWhitelist = req.p.domain_whitelist;

    await setDomainWhitelist(uid, domainWhitelist);

    res.json({
      domain_whitelist: domainWhitelist
    });
  } catch (err) {
    logger.error('Error setting domain whitelist', { error: err, uid: req.p.uid });
    fail(res, 500, 'polis_err_post_domainWhitelist_misc', err);
  }
}

export { handleGetDomainWhitelist, handlePostDomainWhitelist };
