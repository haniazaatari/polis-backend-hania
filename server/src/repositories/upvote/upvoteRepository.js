/**
 * Upvote Repository
 * Handles database operations for upvotes
 */
import { queryP, queryP_readOnly } from '../../db/pg-query.js';
import logger from '../../utils/logger.js';

/**
 * Get upvote by user and conversation
 * @param {number} uid - User ID
 * @param {number} zid - Conversation ID
 * @returns {Promise<Array>} - Array of upvote objects
 */
async function getUpvoteByUserAndConversation(uid, zid) {
  try {
    return await queryP_readOnly('SELECT * FROM upvotes WHERE uid = ($1) AND zid = ($2);', [uid, zid]);
  } catch (error) {
    logger.error('Error getting upvote by user and conversation', error);
    throw error;
  }
}

/**
 * Create a new upvote
 * @param {number} uid - User ID
 * @param {number} zid - Conversation ID
 * @returns {Promise<void>}
 */
async function createUpvote(uid, zid) {
  try {
    await queryP('INSERT INTO upvotes (uid, zid) VALUES ($1, $2);', [uid, zid]);
  } catch (error) {
    logger.error('Error creating upvote', error);
    throw error;
  }
}

/**
 * Update the upvote count for a conversation
 * @param {number} zid - Conversation ID
 * @returns {Promise<void>}
 */
async function updateConversationUpvoteCount(zid) {
  try {
    await queryP(
      'UPDATE conversations SET upvotes = (SELECT COUNT(*) FROM upvotes WHERE zid = ($1)) WHERE zid = ($1);',
      [zid]
    );
  } catch (error) {
    logger.error('Error updating conversation upvote count', error);
    throw error;
  }
}

/**
 * Get upvotes by user
 * @param {number} uid - User ID
 * @returns {Promise<Array>} - Array of upvote objects
 */
async function getUpvotesByUser(uid) {
  try {
    return await queryP_readOnly('SELECT * FROM upvotes WHERE uid = ($1);', [uid]);
  } catch (error) {
    logger.error('Error getting upvotes by user', error);
    throw error;
  }
}

export { getUpvoteByUserAndConversation, createUpvote, updateConversationUpvoteCount, getUpvotesByUser };
