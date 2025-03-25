import crypto from 'crypto';
import LruCache from 'lru-cache';
import { generateToken } from '../../utils/crypto.js';
import logger from '../../utils/logger.js';

import * as db from '../../db/index.js';

// Cache for user tokens to avoid database lookups
const userTokenCache = new LruCache({
  max: 9000
});

/**
 * Generate a password reset token
 * @returns {Promise<string>} - A new password reset token
 */
async function generatePasswordResetToken() {
  return generateToken(100);
}

/**
 * Generate a verification token
 * @returns {Promise<string>} - A new verification token
 */
async function generateVerificationToken() {
  return generateToken(40);
}

/**
 * Generate a random token with specified length
 * @param {number} length - The length of the token to generate
 * @param {boolean} [pseudoRandomOk=false] - Whether to use pseudoRandom generation (faster but less secure)
 * @returns {Promise<string>} - The generated token
 */
async function generateRandomToken(length, pseudoRandomOk = false) {
  return new Promise((resolve, reject) => {
    // Choose the appropriate random bytes generator
    const generator = pseudoRandomOk ? crypto.pseudoRandomBytes : crypto.randomBytes;

    generator(length, (err, buf) => {
      if (err) {
        logger.error('Error generating random token', err);
        return reject(new Error('polis_err_generating_token'));
      }

      // Make the token URL-safe and human-readable
      let token = buf
        .toString('base64')
        .replace(/\//g, 'A')
        .replace(/\+/g, 'B')
        .replace(/l/g, 'C')
        .replace(/L/g, 'D')
        .replace(/o/g, 'E')
        .replace(/O/g, 'F')
        .replace(/1/g, 'G')
        .replace(/0/g, 'H')
        .replace(/I/g, 'J')
        .replace(/g/g, 'K')
        .replace(/G/g, 'M')
        .replace(/q/g, 'N')
        .replace(/Q/g, 'R');

      // Add a random digit at the beginning
      token = Math.floor(Math.random() * 8 + 2) + token.slice(1);

      // Convert to lowercase and trim to requested length
      token = token.toLowerCase().slice(0, length);

      resolve(token);
    });
  });
}

/**
 * Get user ID for a session token
 * @param {string} token - The session token
 * @returns {Promise<number|null>} - The user ID or null if not found
 */
async function getUserIdForToken(token) {
  // Check cache first
  const cachedUid = userTokenCache.get(token);
  if (cachedUid) {
    return cachedUid;
  }

  try {
    const uid = await db.getUserIdForToken(token);

    if (uid) {
      // Cache the result
      userTokenCache.set(token, uid);
    }

    return uid;
  } catch (error) {
    logger.error('Error getting user ID for token', error);
    return null;
  }
}

/**
 * Get user ID for a password reset token
 * @param {string} token - The password reset token
 * @returns {Promise<number|null>} - The user ID or null if not found
 */
async function getUserIdForPasswordResetToken(token) {
  try {
    return await db.getUserIdForPasswordResetToken(token);
  } catch (error) {
    logger.error('Error getting user ID for password reset token', error);
    return null;
  }
}

/**
 * Get user ID for a verification token
 * @param {string} token - The verification token
 * @returns {Promise<number|null>} - The user ID or null if not found
 */
async function getUserIdForVerificationToken(token) {
  try {
    return await db.getUserIdForVerificationToken(token);
  } catch (error) {
    logger.error('Error getting user ID for verification token', error);
    return null;
  }
}

/**
 * Create a password reset token for a user
 * @param {number} uid - The user ID
 * @returns {Promise<string>} - The password reset token
 */
async function createPasswordResetToken(uid) {
  try {
    const token = await generatePasswordResetToken();
    await db.createPasswordResetToken(uid, token);
    return token;
  } catch (error) {
    logger.error('Error creating password reset token', error);
    throw error;
  }
}

/**
 * Clear a password reset token
 * @param {string} token - The password reset token
 * @returns {Promise<void>}
 */
async function clearPasswordResetToken(token) {
  try {
    await db.clearPasswordResetToken(token);
  } catch (error) {
    logger.error('Error clearing password reset token', error);
    throw error;
  }
}

/**
 * Create a verification token for a user
 * @param {number} uid - The user ID
 * @returns {Promise<string>} - The verification token
 */
async function createVerificationToken(uid) {
  try {
    const token = await generateVerificationToken();
    await db.createVerificationToken(uid, token);
    return token;
  } catch (error) {
    logger.error('Error creating verification token', error);
    throw error;
  }
}

/**
 * Clear a verification token
 * @param {string} token - The verification token
 * @returns {Promise<void>}
 */
async function clearVerificationToken(token) {
  try {
    await db.clearVerificationToken(token);
  } catch (error) {
    logger.error('Error clearing verification token', error);
    throw error;
  }
}

/**
 * End a session
 * @param {string} token - The session token
 * @returns {Promise<void>}
 */
async function deleteToken(token) {
  try {
    // Remove from cache
    userTokenCache.del(token);

    // Delete from database
    await db.deleteToken(token);
  } catch (error) {
    logger.error('Error deleting token', error);
    throw error;
  }
}

export {
  generatePasswordResetToken,
  generateVerificationToken,
  generateRandomToken,
  getUserIdForToken,
  getUserIdForPasswordResetToken,
  getUserIdForVerificationToken,
  createPasswordResetToken,
  clearPasswordResetToken,
  createVerificationToken,
  clearVerificationToken,
  deleteToken
};
