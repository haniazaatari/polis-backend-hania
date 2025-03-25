import { updateConversationModifiedTime as dbUpdateConversationModifiedTime } from '../../db/conversationUpdates.js';
import {
  createConversation as dbCreateConversation,
  getCommentsForStats as dbGetCommentsForStats,
  getConversationByConversationId as dbGetConversationByConversationId,
  getConversationByZid as dbGetConversationByZid,
  getConversationForOwner as dbGetConversationForOwner,
  getConversations as dbGetConversations,
  getConversationsWithFieldGreaterThan as dbGetConversationsWithFieldGreaterThan,
  getPageId as dbGetPageId,
  getParticipantInfo as dbGetParticipantInfo,
  getSiteOwner as dbGetSiteOwner,
  getVotesForStats as dbGetVotesForStats,
  getZidFromConversationId as dbGetZidFromConversationId,
  isUserDeveloper as dbIsUserDeveloper,
  registerPageId as dbRegisterPageId,
  registerZinvite as dbRegisterZinvite,
  updateConversation as dbUpdateConversation,
  updateConversationActive as dbUpdateConversationActive,
  verifyMetadataAnswersExistForEachQuestion as dbVerifyMetadataAnswersExistForEachQuestion
} from '../../db/conversations.js';
import logger from '../../utils/logger.js';

/**
 * Get conversation information by ZID
 * @param {number} zid - Conversation ID (ZID)
 * @returns {Promise<Object|null>} - Conversation information or null if not found
 */
async function getConversationByZid(zid) {
  try {
    return await dbGetConversationByZid(zid);
  } catch (error) {
    logger.error('Error getting conversation by ZID', error);
    throw error;
  }
}

/**
 * Get conversation information by conversation ID (zinvite)
 * @param {string} conversationId - Conversation ID (zinvite)
 * @returns {Promise<Object|null>} - Conversation information or null if not found
 */
async function getConversationByConversationId(conversationId) {
  try {
    return await dbGetConversationByConversationId(conversationId);
  } catch (error) {
    logger.error('Error getting conversation by conversation ID', error);
    throw error;
  }
}

/**
 * Get ZID from conversation ID (zinvite)
 * @param {string} conversationId - Conversation ID (zinvite)
 * @returns {Promise<number>} - ZID
 */
async function getZidFromConversationId(conversationId) {
  try {
    return await dbGetZidFromConversationId(conversationId);
  } catch (error) {
    logger.error(`Error getting ZID for conversation ID ${conversationId}`, error);
    throw error;
  }
}

/**
 * Generate and register a zinvite for a conversation
 * @param {number} zid - Conversation ID (ZID)
 * @param {string} zinvite - Zinvite code
 * @returns {Promise<void>}
 */
async function registerZinvite(zid, zinvite) {
  try {
    await dbRegisterZinvite(zid, zinvite);
  } catch (error) {
    logger.error('Error registering zinvite', error);
    throw error;
  }
}

/**
 * Update a conversation
 * @param {number} zid - Conversation ID
 * @param {Object} fields - Fields to update
 * @returns {Promise<Object>} - Updated conversation
 */
async function updateConversation(zid, fields) {
  try {
    return await dbUpdateConversation(zid, fields);
  } catch (error) {
    logger.error('Error updating conversation', { error, zid, fields });
    throw error;
  }
}

/**
 * Update the modified time of a conversation
 * @param {number} zid - Conversation ID
 * @param {number} [modified] - Optional custom modified time
 * @returns {Promise<void>}
 */
async function updateConversationModifiedTime(zid, modified) {
  return dbUpdateConversationModifiedTime(zid, modified);
}

/**
 * Get participant information for a user
 * @param {number} uid - User ID
 * @param {boolean} includeAllConversationsIAmIn - Whether to include all conversations the user is in
 * @returns {Promise<Object>} - Participant information
 */
async function getParticipantInfo(uid, includeAllConversationsIAmIn) {
  try {
    return await dbGetParticipantInfo(uid, includeAllConversationsIAmIn);
  } catch (error) {
    logger.error('Error getting participant info', error);
    throw error;
  }
}

/**
 * Get conversations based on query options
 * @param {Object} options - Query options
 * @returns {Promise<Array>} - Array of conversations
 */
async function getConversations(options) {
  try {
    return await dbGetConversations(options);
  } catch (error) {
    logger.error('Error in getConversations repository', error);
    throw error;
  }
}

/**
 * Verify metadata answers exist for each question
 * @param {number} zid - Conversation ID
 * @returns {Promise<void>}
 */
async function verifyMetadataAnswersExistForEachQuestion(zid) {
  return dbVerifyMetadataAnswersExistForEachQuestion(zid);
}

/**
 * Check if a user is a developer (admin)
 * @param {number} uid - User ID
 * @returns {Promise<boolean>} - Whether the user is a developer
 */
async function isUserDeveloper(uid) {
  try {
    return await dbIsUserDeveloper(uid);
  } catch (error) {
    logger.error('Error checking if user is developer', error);
    throw error;
  }
}

/**
 * Get conversations with a field greater than a specified value
 * @param {string} field - Field to filter by
 * @param {number} value - Value to filter by
 * @returns {Promise<Array>} - Array of conversations
 */
async function getConversationsWithFieldGreaterThan(field, value) {
  try {
    return await dbGetConversationsWithFieldGreaterThan(field, value);
  } catch (error) {
    logger.error('Error getting conversations with field greater than value', error);
    throw error;
  }
}

/**
 * Get comments for conversation statistics
 * @param {number} zid - Conversation ID
 * @param {number} until - Timestamp to filter until
 * @returns {Promise<Array>} - Array of comments
 */
async function getCommentsForStats(zid, until) {
  try {
    return await dbGetCommentsForStats(zid, until);
  } catch (error) {
    logger.error('Error getting comments for stats', error);
    throw error;
  }
}

/**
 * Get votes for conversation statistics
 * @param {number} zid - Conversation ID
 * @param {number} until - Timestamp to filter until
 * @returns {Promise<Array>} - Array of votes
 */
async function getVotesForStats(zid, until) {
  try {
    return await dbGetVotesForStats(zid, until);
  } catch (error) {
    logger.error('Error getting votes for stats', error);
    throw error;
  }
}

/**
 * Get conversation for owner
 * @param {number} zid - Conversation ID
 * @param {number} uid - User ID
 * @returns {Promise<Object|null>} - Conversation or null if not found
 */
async function getConversationForOwner(zid, uid) {
  try {
    return await dbGetConversationForOwner(zid, uid);
  } catch (error) {
    logger.error('Error getting conversation for owner', error);
    throw error;
  }
}

/**
 * Update conversation active status
 * @param {number} zid - Conversation ID
 * @param {boolean} isActive - Whether the conversation should be active
 * @returns {Promise<void>}
 */
async function updateConversationActive(zid, isActive) {
  try {
    await dbUpdateConversationActive(zid, isActive);
  } catch (error) {
    logger.error('Error updating conversation active status', error);
    throw error;
  }
}

/**
 * Create a new conversation
 * @param {Object} conversationData - Conversation data
 * @returns {Promise<Object>} - Created conversation
 */
async function createConversation(conversationData) {
  try {
    return await dbCreateConversation(conversationData);
  } catch (error) {
    logger.error('Error creating conversation', error);
    throw error;
  }
}

/**
 * Get site owner by site ID
 * @param {string} site_id - Site ID
 * @returns {Promise<Object|null>} - Site owner or null if not found
 */
async function getSiteOwner(site_id) {
  try {
    return await dbGetSiteOwner(site_id);
  } catch (error) {
    logger.error('Error getting site owner', error);
    throw error;
  }
}

/**
 * Register page ID
 * @param {string} site_id - Site ID
 * @param {string} page_id - Page ID
 * @param {number} zid - Conversation ID
 * @returns {Promise<void>}
 */
async function registerPageId(site_id, page_id, zid) {
  try {
    await dbRegisterPageId(site_id, page_id, zid);
  } catch (error) {
    logger.error('Error registering page ID', error);
    throw error;
  }
}

/**
 * Get page ID
 * @param {string} site_id - Site ID
 * @param {string} page_id - Page ID
 * @returns {Promise<Object|null>} - Page ID info or null if not found
 */
async function getPageId(site_id, page_id) {
  try {
    return await dbGetPageId(site_id, page_id);
  } catch (error) {
    logger.error('Error getting page ID', error);
    throw error;
  }
}

export {
  createConversation,
  getCommentsForStats,
  getConversationByConversationId,
  getConversationByZid,
  getConversationForOwner,
  getConversations,
  getConversationsWithFieldGreaterThan,
  getPageId,
  getParticipantInfo,
  getSiteOwner,
  getVotesForStats,
  getZidFromConversationId,
  isUserDeveloper,
  registerPageId,
  registerZinvite,
  updateConversation,
  updateConversationActive,
  updateConversationModifiedTime,
  verifyMetadataAnswersExistForEachQuestion
};
