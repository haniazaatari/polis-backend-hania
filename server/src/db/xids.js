import logger from '../utils/logger.js';
import { queryP } from './pg-query.js';

/**
 * Create an XID record
 * @param {number|string} ownerOrXid - Owner ID or XID
 * @param {number} uid - User ID
 * @param {string} [xidParam] - External ID (optional if ownerOrXid is the XID)
 * @param {string|null} [x_profile_image_url] - Profile image URL
 * @param {string|null} [x_name] - Name
 * @param {string|null} [x_email] - Email
 * @param {boolean} [returnRecord] - Whether to return the created record
 * @returns {Promise<Array|void>} - Created XID record if returnRecord is true
 */
async function createXidRecord(ownerOrXid, uid, xidParam, x_profile_image_url, x_name, x_email, returnRecord = false) {
  try {
    // Handle the case where ownerOrXid is the XID (simplified call)
    let owner;
    let xid;

    if (typeof ownerOrXid === 'string' && xidParam === undefined) {
      // Simplified call with just XID and UID
      owner = 0; // Default owner ID
      xid = ownerOrXid;
    } else {
      // Normal call with owner and XID
      owner = ownerOrXid;
      xid = xidParam;
    }

    const query = returnRecord
      ? 'INSERT INTO xids (owner, uid, xid, x_profile_image_url, x_name, x_email) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;'
      : 'INSERT INTO xids (owner, uid, xid, x_profile_image_url, x_name, x_email) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (owner, xid) DO NOTHING;';

    const result = await queryP(query, [owner, uid, xid, x_profile_image_url || null, x_name || null, x_email || null]);

    return returnRecord ? result : undefined;
  } catch (error) {
    logger.error('Error creating XID record', error);
    throw error;
  }
}

/**
 * Create an XID record by ZID
 * @param {number} zid - Conversation ID (ZID)
 * @param {number} uid - User ID
 * @param {string} xid - External ID
 * @param {string|null} x_profile_image_url - Profile image URL
 * @param {string|null} x_name - Name
 * @param {string|null} x_email - Email
 * @param {boolean} returnRecord - Whether to return the created record
 * @returns {Promise<Array|void>} - Created XID record if returnRecord is true
 */
async function createXidRecordByZid(zid, uid, xid, x_profile_image_url, x_name, x_email, returnRecord = false) {
  try {
    const query = returnRecord
      ? 'INSERT INTO xids (owner, uid, xid, x_profile_image_url, x_name, x_email) ' +
        'VALUES ((SELECT org_id FROM conversations WHERE zid = ($1)), $2, $3, $4, $5, $6) RETURNING *;'
      : 'INSERT INTO xids (owner, uid, xid, x_profile_image_url, x_name, x_email) ' +
        'VALUES ((SELECT org_id FROM conversations WHERE zid = ($1)), $2, $3, $4, $5, $6) ' +
        'ON CONFLICT (owner, xid) DO NOTHING;';

    const result = await queryP(query, [zid, uid, xid, x_profile_image_url || null, x_name || null, x_email || null]);

    return returnRecord ? result : undefined;
  } catch (error) {
    logger.error('Error creating XID record by ZID', error);
    throw error;
  }
}

/**
 * Check if an XID is whitelisted for an owner
 * @param {number} owner - Owner ID
 * @param {string} xid - External ID
 * @returns {Promise<boolean>} - Whether the XID is whitelisted
 */
async function isXidWhitelisted(owner, xid) {
  try {
    const result = await queryP('SELECT * FROM xid_whitelist WHERE owner = ($1) AND xid = ($2);', [owner, xid]);
    return result && result.length > 0;
  } catch (error) {
    logger.error('Error checking if XID is whitelisted', error);
    throw error;
  }
}

/**
 * Get XID record by owner and XID
 * @param {number} owner - Owner ID
 * @param {string} xid - External ID
 * @returns {Promise<Array>} - XID record
 */
async function getXidRecord(owner, xid) {
  try {
    return await queryP('SELECT * FROM xids WHERE owner = ($1) AND xid = ($2);', [owner, xid]);
  } catch (error) {
    logger.error('Error getting XID record', error);
    throw error;
  }
}

/**
 * Get XID record by XID owner ID
 * @param {number} xid_owner - XID owner ID
 * @returns {Promise<Array>} - XID record
 */
async function getXidRecordByXidOwnerId(xid_owner) {
  try {
    return await queryP('SELECT * FROM xids WHERE owner = ($1);', [xid_owner]);
  } catch (error) {
    logger.error('Error getting XID record by XID owner ID', error);
    throw error;
  }
}

/**
 * Get user by XID
 * @param {string} xid - External ID
 * @returns {Promise<Object|null>} - User object or null if not found
 */
async function getUserByXid(xid) {
  try {
    const result = await queryP('SELECT uid FROM xids WHERE xid = ($1) LIMIT 1;', [xid]);
    return result && result.length > 0 ? result[0] : null;
  } catch (error) {
    logger.error('Error getting user by XID', error);
    throw error;
  }
}

/**
 * Check if an XID exists for a given organization and user
 * @param {string} xid - External ID
 * @param {number} org_id - Organization ID
 * @param {number} uid - User ID
 * @returns {Promise<boolean>} - Whether the XID exists
 */
async function xidExists(xid, org_id, uid) {
  try {
    const result = await queryP('SELECT * FROM xids WHERE xid = ($1) AND owner = ($2) AND uid = ($3);', [
      xid,
      org_id,
      uid
    ]);
    return result && result.length > 0;
  } catch (error) {
    logger.error('Error checking if XID exists', error);
    throw error;
  }
}

/**
 * Create an XID entry
 * @param {string} xid - External ID
 * @param {number} org_id - Organization ID
 * @param {number} uid - User ID
 * @returns {Promise<Array>} - Created XID record
 */
async function createXidEntry(xid, org_id, uid) {
  return createXidRecord(org_id, uid, xid, null, null, null, true);
}

export {
  createXidEntry,
  createXidRecord,
  createXidRecordByZid,
  getUserByXid,
  getXidRecord,
  getXidRecordByXidOwnerId,
  isXidWhitelisted,
  xidExists
};
