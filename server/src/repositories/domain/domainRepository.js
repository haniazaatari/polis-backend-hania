/**
 * Domain Repository
 * Handles database operations related to domains
 */
import {
  createDomainWhitelistRecord as dbCreateDomainWhitelistRecord,
  getDomainWhitelistRecord as dbGetDomainWhitelistRecord,
  updateDomainWhitelistRecord as dbUpdateDomainWhitelistRecord
} from '../../db/domains.js';

/**
 * Get domain whitelist record for a user
 * @param {number} uid - User ID
 * @returns {Promise<Object|null>} - Domain whitelist record or null if not found
 */
async function getDomainWhitelistRecord(uid) {
  return dbGetDomainWhitelistRecord(uid);
}

/**
 * Create domain whitelist record for a user
 * @param {number} uid - User ID
 * @param {Object} data - Data to insert
 * @returns {Promise<void>} - Promise that resolves when the record is created
 */
async function createDomainWhitelistRecord(uid, data) {
  return dbCreateDomainWhitelistRecord(uid, data);
}

/**
 * Update domain whitelist record for a user
 * @param {number} uid - User ID
 * @param {Object} data - Data to update
 * @returns {Promise<void>} - Promise that resolves when the record is updated
 */
async function updateDomainWhitelistRecord(uid, data) {
  return dbUpdateDomainWhitelistRecord(uid, data);
}

export { getDomainWhitelistRecord, createDomainWhitelistRecord, updateDomainWhitelistRecord };
