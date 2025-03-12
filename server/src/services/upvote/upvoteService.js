/**
 * Upvote Service
 * Handles business logic for upvoting conversations
 */
import * as upvoteRepository from '../../repositories/upvote/upvoteRepository.js';
import logger from '../../utils/logger.js';

/**
 * Check if a user has already upvoted a conversation
 * @param {number} uid - User ID
 * @param {number} zid - Conversation ID
 * @returns {Promise<boolean>} - True if the user has already upvoted the conversation
 */
async function hasUserUpvotedConversation(uid, zid) {
  try {
    const upvotes = await upvoteRepository.getUpvoteByUserAndConversation(uid, zid);
    return upvotes && upvotes.length > 0;
  } catch (error) {
    logger.error('Error checking if user has upvoted conversation', error);
    throw error;
  }
}

/**
 * Add an upvote for a conversation
 * @param {number} uid - User ID
 * @param {number} zid - Conversation ID
 * @returns {Promise<void>}
 */
async function addUpvote(uid, zid) {
  try {
    await upvoteRepository.createUpvote(uid, zid);
  } catch (error) {
    logger.error('Error adding upvote', error);
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
    await upvoteRepository.updateConversationUpvoteCount(zid);
  } catch (error) {
    logger.error('Error updating conversation upvote count', error);
    throw error;
  }
}

/**
 * Get upvotes for a user
 * @param {number} uid - User ID
 * @returns {Promise<Array>} - Array of upvotes
 */
async function getUpvotesForUser(uid) {
  try {
    return await upvoteRepository.getUpvotesByUser(uid);
  } catch (error) {
    logger.error('Error getting upvotes for user', error);
    throw error;
  }
}

export { hasUserUpvotedConversation, addUpvote, updateConversationUpvoteCount, getUpvotesForUser };
