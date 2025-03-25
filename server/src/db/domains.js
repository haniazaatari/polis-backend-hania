import logger from '../utils/logger.js';
import { queryP } from './pg-query.js';
import { queryP_readOnly } from './pg-query.js';

/**
 * Get domain whitelist record for a user
 * @param {number} uid - User ID
 * @returns {Promise<Object|null>} - Domain whitelist record or null if not found
 */
async function getDomainWhitelistRecord(uid) {
  try {
    const rows = await queryP(
      'select * from site_domain_whitelist where site_id = (select site_id from users where uid = ($1));',
      [uid]
    );

    return rows?.length ? rows[0] : null;
  } catch (err) {
    logger.error('Error getting domain whitelist record', { error: err, uid });
    throw err;
  }
}

/**
 * Create domain whitelist record for a user
 * @param {number} uid - User ID
 * @param {Object} data - Data to insert
 * @returns {Promise<void>} - Promise that resolves when the record is created
 */
async function createDomainWhitelistRecord(uid, data) {
  try {
    const columns = Object.keys(data).join(', ');
    const placeholders = Object.keys(data)
      .map((_, i) => `$${i + 2}`)
      .join(', ');
    const values = Object.values(data);

    await queryP(
      `insert into site_domain_whitelist (site_id, ${columns}) values ((select site_id from users where uid = ($1)), ${placeholders});`,
      [uid, ...values]
    );
  } catch (err) {
    logger.error('Error creating domain whitelist record', { error: err, uid, data });
    throw err;
  }
}

/**
 * Update domain whitelist record for a user
 * @param {number} uid - User ID
 * @param {Object} data - Data to update
 * @returns {Promise<void>} - Promise that resolves when the record is updated
 */
async function updateDomainWhitelistRecord(uid, data) {
  try {
    const setClause = Object.keys(data)
      .map((key, i) => `${key} = ($${i + 2})`)
      .join(', ');
    const values = Object.values(data);

    await queryP(
      `update site_domain_whitelist set ${setClause} where site_id = (select site_id from users where uid = ($1));`,
      [uid, ...values]
    );
  } catch (err) {
    logger.error('Error updating domain whitelist record', { error: err, uid, data });
    throw err;
  }
}

/**
 * Get domain whitelist for a conversation
 * @param {number} zid - Conversation ID
 * @returns {Promise<Object|null>} - Domain whitelist info or null if not found
 */
async function getDomainWhitelist(zid) {
  const rows = await queryP_readOnly(
    'select * from site_domain_whitelist where site_id = ' +
      '(select site_id from users where uid = ' +
      '(select owner from conversations where zid = ($1)));',
    [zid]
  );

  return rows?.length ? rows[0] : null;
}

/**
 * Gets domain whitelist for a site
 * @param {number} siteId - Site ID
 * @returns {Promise<Array<string>>} - Array of whitelisted domain patterns
 */
async function getDomainWhitelistForSite(siteId) {
  try {
    const rows = await queryP_readOnly('SELECT domain_whitelist FROM site_domain_whitelist WHERE site_id = ($1);', [
      siteId
    ]);

    if (!rows?.length || !rows[0].domain_whitelist?.length) {
      return [];
    }

    return rows[0].domain_whitelist.split(',');
  } catch (error) {
    logger.error('Error getting domain whitelist', { error, siteId });
    throw error;
  }
}

/**
 * Checks if a domain matches a pattern
 * @param {string} domain - The domain to check
 * @param {string} pattern - The pattern to match against
 * @returns {boolean} - True if domain matches pattern
 */
function checkDomainPattern(domain, pattern) {
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

export {
  checkDomainPattern,
  createDomainWhitelistRecord,
  getDomainWhitelist,
  getDomainWhitelistForSite,
  getDomainWhitelistRecord,
  updateDomainWhitelistRecord
};
