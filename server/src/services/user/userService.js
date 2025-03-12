import * as pg from '../../db/pg-query.js';
import * as userRepository from '../../repositories/user/userRepository.js';
import * as xidRepository from '../../repositories/xid/xidRepository.js';
import logger from '../../utils/logger.js';
import { generateHashedPassword } from '../auth/passwordService.js';
import * as tokenService from '../auth/tokenService.js';
import * as emailService from '../email/emailService.js';

/**
 * Get user by email
 * @param {string} email - The user's email
 * @returns {Promise<Object|null>} - The user object or null if not found
 */
async function getUserByEmail(email) {
  try {
    return await userRepository.getUserByEmail(email);
  } catch (error) {
    logger.error('Error getting user by email', error);
    throw error;
  }
}

/**
 * Create a new user
 * @param {Object} userData - The user data
 * @param {string} userData.email - The user's email
 * @param {string} userData.password - The user's password
 * @param {string} userData.hname - The user's name
 * @param {string} userData.zinvite - Optional conversation invite
 * @param {string} userData.organization - Optional organization
 * @returns {Promise<Object>} - Creation result
 */
async function createUser(userData) {
  try {
    // Validation
    if (!userData.email || !userData.password || !userData.hname) {
      return { success: false, error: 'polis_err_missing_required_fields' };
    }

    if (userData.password.length < 6) {
      return { success: false, error: 'polis_err_reg_password_too_short' };
    }

    if (!userData.email.includes('@') || userData.email.length < 3) {
      return { success: false, error: 'polis_err_reg_bad_email' };
    }

    // Check if email already exists
    const existingUser = await userRepository.getUserByEmail(userData.email);
    if (existingUser) {
      return { success: false, error: 'polis_err_reg_user_with_that_email_exists' };
    }

    // Hash password using passwordService
    const pwhash = await generateHashedPassword(userData.password);

    // Create user
    const user = await userRepository.createUser({
      email: userData.email,
      hname: userData.hname,
      pwhash,
      zinvite: userData.zinvite,
      oinvite: userData.oinvite,
      site_id: userData.site_id
    });

    // Send verification email
    await emailService.sendVerificationEmail(user.uid, userData.email, userData.hname);

    // Return success
    return {
      success: true,
      uid: user.uid,
      email: user.email,
      hname: user.hname
    };
  } catch (error) {
    logger.error('Error creating user', error);
    return { success: false, error: 'polis_err_reg_failed' };
  }
}

/**
 * Reset a user's password
 * @param {string} token - The password reset token
 * @param {string} password - The new password
 * @returns {Promise<Object>} - Reset result
 */
async function resetPassword(token, password) {
  try {
    // Get user ID for token
    const uid = await tokenService.getUserIdForPasswordResetToken(token);

    if (!uid) {
      return { success: false, error: 'polis_err_reset_invalid_token' };
    }

    // Hash new password
    const pwhash = await generateHashedPassword(password);

    // Update password
    await userRepository.updatePassword(uid, pwhash);

    // Clear token
    await tokenService.clearPasswordResetToken(token);

    return { success: true, uid };
  } catch (error) {
    logger.error('Error resetting password', error);
    return { success: false, error: 'polis_err_reset_failed' };
  }
}

/**
 * Mark a user as verified
 * @param {number} uid - The user ID
 * @returns {Promise<Object>} - The updated user
 */
async function markUserAsVerified(uid) {
  try {
    return await userRepository.markUserAsVerified(uid);
  } catch (error) {
    logger.error('Error marking user as verified', error);
    throw error;
  }
}

/**
 * Gets user information for a user ID
 * @param {number} uid - User ID
 * @returns {Promise<Object>} - User information
 */
async function getUserInfoForUid2(uid) {
  try {
    return await userRepository.getUserById(uid);
  } catch (err) {
    logger.error('Error getting user info', err);
    throw err;
  }
}

/**
 * Gets comprehensive user information including social media and XID data
 * @param {number} uid - User ID
 * @param {number} [zid_optional] - Optional conversation ID
 * @param {string} [xid_optional] - Optional external ID
 * @param {number} [owner_uid_optional] - Optional owner user ID
 * @returns {Promise<Object>} - Comprehensive user information
 */
async function getUser(uid, zid_optional, xid_optional, owner_uid_optional) {
  if (!uid) {
    return {};
  }

  let xidInfoPromise = Promise.resolve(null);
  if (zid_optional && xid_optional) {
    xidInfoPromise = xidRepository.getXidRecord(xid_optional, zid_optional);
  } else if (xid_optional && owner_uid_optional) {
    xidInfoPromise = getXidRecordByXidOwnerId(xid_optional, owner_uid_optional, zid_optional);
  }

  const [info, xInfo] = await Promise.all([getUserInfoForUid2(uid), xidInfoPromise]);

  const hasXid = xInfo?.length && xInfo[0];

  if (hasXid) {
    xInfo[0].owner = undefined;
    xInfo[0].created = undefined;
    xInfo[0].uid = undefined;
  }

  return {
    uid: uid,
    email: info.email,
    hname: info.hname,
    hasXid: !!hasXid,
    xInfo: xInfo?.[0],
    finishedTutorial: !!info.tut,
    site_ids: [info.site_id],
    created: Number(info.created)
  };
}

/**
 * Gets the user ID for an API key
 * @param {string} apiKey - API key
 * @returns {Promise<Array>} - Array of user records
 */
async function getUidForApiKey(apiKey) {
  try {
    return await pg.queryP_readOnly('SELECT * FROM apikeysndvweifu WHERE apikey = ($1);', [apiKey]);
  } catch (err) {
    logger.error('Error getting UID for API key', err);
    throw err;
  }
}

/**
 * Gets an XID record by XID and owner ID
 * @param {string} xid - External ID
 * @param {number} owner - Owner ID
 * @param {number|undefined} _zid_optional - Optional conversation ID
 * @param {string|null} x_profile_image_url - Profile image URL (optional)
 * @param {string|null} x_name - Name (optional)
 * @param {string|null} x_email - Email (optional)
 * @param {boolean|null} createIfMissing - Whether to create if missing (optional)
 * @returns {Promise<Array>} - Array of XID records
 */
async function getXidRecordByXidOwnerId(
  xid,
  owner,
  _zid_optional,
  x_profile_image_url = null,
  x_name = null,
  x_email = null,
  createIfMissing = true
) {
  try {
    // Try to find existing record
    const existing = await xidRepository.getXidRecordByXidOwnerId(owner);

    if (existing?.length) {
      return existing;
    }

    // Create if missing and requested
    if (createIfMissing) {
      const uid = 1; // Default user ID for system
      return await xidRepository.createXidRecord(
        owner,
        uid,
        xid,
        x_profile_image_url,
        x_name,
        x_email,
        createIfMissing
      );
    }

    return null;
  } catch (err) {
    logger.error('Error in getXidRecordByXidOwnerId', err);
    throw err;
  }
}

/**
 * Creates a dummy user
 * @returns {Promise<number>} - The created user ID
 */
async function createDummyUser() {
  try {
    return await userRepository.createDummyUser();
  } catch (err) {
    logger.error('Error creating dummy user', err);
    throw err;
  }
}

/**
 * Get or create a user by XID
 * @param {string} xid - External ID
 * @returns {Promise<number|null>} - User ID or null if failed
 */
async function getOrCreateUserByXid(xid) {
  try {
    // First try to get the user by XID
    const existingUser = await xidRepository.getUserByXid(xid);
    if (existingUser?.uid) {
      return existingUser.uid;
    }

    // If not found, create a new user
    const uid = await createDummyUser();

    // Associate the XID with the new user (simplified call)
    await xidRepository.createXidRecord(xid, uid);

    return uid;
  } catch (error) {
    logger.error('Error getting or creating user by XID', error);
    return null;
  }
}

/**
 * Update a user's information
 * @param {number} uid - The user ID
 * @param {Object} fields - Fields to update
 * @returns {Promise<Object>} - The update result
 */
async function updateUser(uid, fields) {
  try {
    return await userRepository.updateUser(uid, fields);
  } catch (error) {
    logger.error('Error updating user', error);
    throw error;
  }
}

export {
  createUser,
  resetPassword,
  markUserAsVerified,
  getUserInfoForUid2,
  getUser,
  getUserByEmail,
  getUidForApiKey,
  getXidRecordByXidOwnerId,
  createDummyUser,
  getOrCreateUserByXid,
  updateUser
};
