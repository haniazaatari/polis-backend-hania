import logger from '../utils/logger.js';
import { queryP } from './pg-query.js';

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

export { getDomainWhitelistRecord, createDomainWhitelistRecord, updateDomainWhitelistRecord };
