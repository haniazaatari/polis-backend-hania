import {
  commentExists,
  createComment as createCommentInDb,
  getCommentByIdFromDb,
  getCommentTranslationsFromDb,
  getCommentsForModerationFromDb,
  getCommentsListFromDb,
  getNumberOfCommentsRemainingFromDb,
  storeCommentTranslationInDb,
  updateCommentModeration
} from '../../db/comments.js';
import logger from '../../utils/logger.js';

/**
 * Get a comment by ID
 * @param {number} zid - Conversation ID
 * @param {number} tid - Comment ID
 * @returns {Promise<Object|null>} - Comment or null if not found
 */
async function getCommentById(zid, tid) {
  try {
    return await getCommentByIdFromDb(zid, tid);
  } catch (error) {
    logger.error('Error getting comment by ID', error);
    throw error;
  }
}

/**
 * Update a comment's moderation status
 * @param {number} zid - Conversation ID
 * @param {number} tid - Comment ID
 * @param {boolean} active - Whether the comment is active
 * @param {number} mod - Moderation status
 * @param {boolean} is_meta - Whether the comment is meta
 * @returns {Promise<Object>} - Result of the moderation
 */
async function moderateComment(zid, tid, active, mod, is_meta) {
  try {
    return await updateCommentModeration(zid, tid, active, mod, is_meta);
  } catch (error) {
    logger.error('Error moderating comment', error);
    throw error;
  }
}

/**
 * Get comments for moderation
 * @param {Object} options - Query options
 * @returns {Promise<Array>} - Comments
 */
async function getCommentsForModeration(options) {
  try {
    return await getCommentsForModerationFromDb(options);
  } catch (error) {
    logger.error('Error getting comments for moderation', error);
    throw error;
  }
}

/**
 * Get comments list
 * @param {Object} options - Query options
 * @returns {Promise<Array>} - Comments
 */
async function getCommentsList(options) {
  try {
    return await getCommentsListFromDb(options);
  } catch (error) {
    logger.error('Error getting comments list', error);
    throw error;
  }
}

/**
 * Get number of comments remaining
 * @param {number} zid - Conversation ID
 * @param {number} pid - Participant ID
 * @returns {Promise<Array>} - Remaining comments info
 */
async function getNumberOfCommentsRemaining(zid, pid) {
  try {
    return await getNumberOfCommentsRemainingFromDb(zid, pid);
  } catch (error) {
    logger.error('Error getting number of comments remaining', error);
    throw error;
  }
}

/**
 * Store a comment translation
 * @param {number} zid - Conversation ID
 * @param {number} tid - Comment ID
 * @param {string} translation - Translated text
 * @param {string} lang - Language code
 * @param {number} src - Source
 * @returns {Promise<Object|null>} - Stored translation
 */
async function storeCommentTranslation(zid, tid, translation, lang, src) {
  try {
    return await storeCommentTranslationInDb(zid, tid, translation, lang, src);
  } catch (error) {
    logger.error('Error storing comment translation', error);
    throw error;
  }
}

/**
 * Get translations for a comment
 * @param {number} zid - Conversation ID
 * @param {number} tid - Comment ID
 * @returns {Promise<Array>} - Array of translations
 */
async function getCommentTranslations(zid, tid) {
  try {
    return await getCommentTranslationsFromDb(zid, tid);
  } catch (error) {
    logger.error('Error getting comment translations', error);
    throw error;
  }
}

/**
 * Create a new comment
 * @param {Object} params - Comment parameters
 * @param {number} params.pid - The participant ID
 * @param {number} params.zid - The conversation ID
 * @param {string} params.txt - The comment text
 * @param {number} params.velocity - The comment velocity
 * @param {boolean} params.active - Whether the comment is active
 * @param {number} params.mod - The moderation status
 * @param {number} params.uid - The user ID
 * @param {boolean} params.anon - Whether the comment is anonymous
 * @param {boolean} params.is_seed - Whether the comment is a seed
 * @param {string} params.lang - The comment language
 * @param {number} params.lang_confidence - The language detection confidence
 * @returns {Promise<Object>} - The created comment
 */
async function createComment(params) {
  try {
    return await createCommentInDb(params);
  } catch (error) {
    logger.error('Error creating comment in repository', error);
    throw error;
  }
}

export {
  getCommentById,
  getCommentsForModeration,
  getCommentsList,
  getNumberOfCommentsRemaining,
  storeCommentTranslation,
  getCommentTranslations,
  commentExists,
  moderateComment,
  createComment
};
