/**
 * Zinvite Service
 * Handles business logic for zinvites (conversation invitations)
 */
import * as db from '../../db/index.js';
import logger from '../../utils/logger.js';
import { generateRandomToken } from '../auth/tokenService.js';

/**
 * Check if a user is the owner of a conversation
 * @param {number} zid - Conversation ID
 * @param {number} uid - User ID
 * @returns {Promise<boolean>} - True if the user is the owner, false otherwise
 */
async function isConversationOwner(zid, uid) {
  try {
    const result = await db.getConversationOwner(zid, uid);
    return result && result.length > 0;
  } catch (error) {
    logger.error('Error checking conversation ownership', error);
    throw error;
  }
}

/**
 * Get all zinvites for a conversation
 * @param {number} zid - Conversation ID
 * @returns {Promise<Array>} - Array of zinvite objects
 */
async function getZinvitesForConversation(zid) {
  try {
    return await db.getZinvitesForConversation(zid);
  } catch (error) {
    logger.error('Error getting zinvites for conversation', error);
    throw error;
  }
}

/**
 * Generate a new zinvite code
 * @param {boolean} generateShort - Whether to generate a short zinvite
 * @returns {Promise<string>} - The generated zinvite code
 */
async function generateZinviteCode(generateShort) {
  try {
    const length = generateShort ? 6 : 12;
    return await generateRandomToken(length, false);
  } catch (error) {
    logger.error('Error generating zinvite code', error);
    throw new Error('polis_err_creating_zinvite');
  }
}

/**
 * Generate and register a new zinvite for a conversation
 * @param {number} zid - Conversation ID
 * @param {boolean} generateShort - Whether to generate a short zinvite
 * @returns {Promise<string>} - The generated zinvite code
 */
async function generateAndRegisterZinvite(zid, generateShort) {
  try {
    // Generate a new zinvite code
    const zinvite = await generateZinviteCode(generateShort);

    // Check if there's an existing zinvite for this conversation
    const existingZinvites = await db.getZinvitesForConversation(zid);

    if (existingZinvites && existingZinvites.length > 0) {
      // Update the existing zinvite
      await db.updateZinvite(zid, zinvite);
    } else {
      // Create a new zinvite
      await db.createZinvite(zid, zinvite);
    }

    return zinvite;
  } catch (error) {
    logger.error('Error generating and registering zinvite', error);
    throw error;
  }
}

/**
 * Get a zinvite for a conversation
 * @param {number} zid - Conversation ID
 * @param {boolean} dontUseCache - Whether to bypass the cache
 * @returns {Promise<string>} - The zinvite code
 */
async function getZinvite(zid, dontUseCache = false) {
  try {
    return await db.getZinvite(zid, dontUseCache);
  } catch (error) {
    logger.error('Error getting zinvite', error);
    throw error;
  }
}

/**
 * Get zinvites for multiple conversations
 * @param {Array<number>} zids - Array of conversation IDs
 * @returns {Promise<Object>} - Object mapping zids to zinvites
 */
async function getZinvites(zids) {
  try {
    return await db.getZinvites(zids);
  } catch (error) {
    logger.error('Error getting zinvites', error);
    throw error;
  }
}

/**
 * Check if a zinvite code is valid for a conversation
 * @param {number} zid - Conversation ID
 * @param {string} zinvite - Zinvite code
 * @returns {Promise<boolean>} - True if the zinvite is valid, false otherwise
 */
async function isZinviteValid(zid, zinvite) {
  try {
    const result = await db.checkZinviteValidity(zid, zinvite);
    return result;
  } catch (error) {
    logger.error('Error checking zinvite validity', error);
    throw error;
  }
}

/**
 * Check if a single-use zinvite code is valid for a conversation
 * @param {number} zid - Conversation ID
 * @param {string} suzinvite - Single-use zinvite code
 * @returns {Promise<boolean>} - True if the suzinvite is valid, false otherwise
 */
async function isSuzinviteValid(zid, suzinvite) {
  try {
    const result = await db.checkSuzinviteValidity(zid, suzinvite);
    return result;
  } catch (error) {
    logger.error('Error checking suzinvite validity', error);
    throw error;
  }
}

export {
  isConversationOwner,
  getZinvitesForConversation,
  generateAndRegisterZinvite,
  getZinvite,
  getZinvites,
  isZinviteValid,
  isSuzinviteValid
};
