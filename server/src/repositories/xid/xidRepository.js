/**
 * XID Repository
 * Handles database operations related to external IDs (XIDs)
 */

import {
  createXidEntry as dbCreateXidEntry,
  createXidRecord as dbCreateXidRecord,
  createXidRecordByZid as dbCreateXidRecordByZid,
  getUserByXid as dbGetUserByXid,
  getXidRecord as dbGetXidRecord,
  getXidRecordByXidOwnerId as dbGetXidRecordByXidOwnerId,
  isXidWhitelisted as dbIsXidWhitelisted,
  xidExists as dbXidExists
} from '../../db/xids.js';

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
  return dbCreateXidRecord(ownerOrXid, uid, xidParam, x_profile_image_url, x_name, x_email, returnRecord);
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
  return dbCreateXidRecordByZid(zid, uid, xid, x_profile_image_url, x_name, x_email, returnRecord);
}

/**
 * Check if an XID is whitelisted for an owner
 * @param {number} owner - Owner ID
 * @param {string} xid - External ID
 * @returns {Promise<boolean>} - Whether the XID is whitelisted
 */
async function isXidWhitelisted(owner, xid) {
  return dbIsXidWhitelisted(owner, xid);
}

/**
 * Get XID record by owner and XID
 * @param {number} owner - Owner ID
 * @param {string} xid - External ID
 * @returns {Promise<Array>} - XID record
 */
async function getXidRecord(owner, xid) {
  return dbGetXidRecord(owner, xid);
}

/**
 * Get XID record by XID owner ID
 * @param {number} xid_owner - XID owner ID
 * @returns {Promise<Array>} - XID record
 */
async function getXidRecordByXidOwnerId(xid_owner) {
  return dbGetXidRecordByXidOwnerId(xid_owner);
}

/**
 * Get user by XID
 * @param {string} xid - External ID
 * @returns {Promise<Object|null>} - User object or null if not found
 */
async function getUserByXid(xid) {
  return dbGetUserByXid(xid);
}

/**
 * Check if an XID exists for a given organization and user
 * @param {string} xid - External ID
 * @param {number} org_id - Organization ID
 * @param {number} uid - User ID
 * @returns {Promise<boolean>} - Whether the XID exists
 */
async function xidExists(xid, org_id, uid) {
  return dbXidExists(xid, org_id, uid);
}

/**
 * Create an XID entry
 * @param {string} xid - External ID
 * @param {number} org_id - Organization ID
 * @param {number} uid - User ID
 * @returns {Promise<Array>} - Created XID record
 */
async function createXidEntry(xid, org_id, uid) {
  return dbCreateXidEntry(xid, org_id, uid);
}

export {
  createXidRecord,
  createXidRecordByZid,
  isXidWhitelisted,
  getXidRecord,
  getXidRecordByXidOwnerId,
  getUserByXid,
  xidExists,
  createXidEntry
};
