/**
 * Domain Service
 * Handles business logic for domain-related operations
 */
import * as db from '../../db/index.js';
import logger from '../../utils/logger.js';

/**
 * Set the domain whitelist for a user
 * @param {number} uid - User ID
 * @param {string} newWhitelist - Comma-separated list of domains
 * @returns {Promise<void>} - Promise that resolves when the whitelist is set
 */
async function setDomainWhitelist(uid, newWhitelist) {
  try {
    // Check if a whitelist already exists for this user
    const record = await db.getDomainWhitelistRecord(uid);

    // If no whitelist exists, create a new one
    if (!record) {
      await db.createDomainWhitelistRecord(uid, { domain_whitelist: newWhitelist });
      return;
    }

    // Otherwise, update the existing whitelist
    await db.updateDomainWhitelistRecord(uid, { domain_whitelist: newWhitelist });
  } catch (err) {
    logger.error('Error setting domain whitelist', { error: err, uid });
    throw err;
  }
}

/**
 * Get the domain whitelist for a user
 * @param {number} uid - User ID
 * @returns {Promise<string>} - Comma-separated list of domains
 */
async function getDomainWhitelist(uid) {
  try {
    const record = await db.getDomainWhitelistRecord(uid);

    // If no whitelist exists, return an empty string
    if (!record) {
      return '';
    }

    return record.domain_whitelist || '';
  } catch (err) {
    logger.error('Error getting domain whitelist', { error: err, uid });
    throw err;
  }
}

/**
 * Set the domain whitelist override key for a user
 * @param {number} uid - User ID
 * @param {string} overrideKey - Override key
 * @returns {Promise<void>} - Promise that resolves when the override key is set
 */
async function setDomainWhitelistOverrideKey(uid, overrideKey) {
  try {
    // Check if a whitelist already exists for this user
    const record = await db.getDomainWhitelistRecord(uid);

    // If no whitelist exists, create a new one
    if (!record) {
      await db.createDomainWhitelistRecord(uid, { domain_whitelist_override_key: overrideKey });
      return;
    }

    // Otherwise, update the existing whitelist
    await db.updateDomainWhitelistRecord(uid, { domain_whitelist_override_key: overrideKey });
  } catch (err) {
    logger.error('Error setting domain whitelist override key', { error: err, uid });
    throw err;
  }
}

/**
 * Get the domain whitelist override key for a user
 * @param {number} uid - User ID
 * @returns {Promise<string>} - Override key
 */
async function getDomainWhitelistOverrideKey(uid) {
  try {
    const record = await db.getDomainWhitelistRecord(uid);

    // If no whitelist exists, return an empty string
    if (!record) {
      return '';
    }

    return record.domain_whitelist_override_key || '';
  } catch (err) {
    logger.error('Error getting domain whitelist override key', { error: err, uid });
    throw err;
  }
}

export { setDomainWhitelist, getDomainWhitelist, setDomainWhitelistOverrideKey, getDomainWhitelistOverrideKey };
