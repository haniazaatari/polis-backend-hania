import _ from 'underscore';
import * as commentRepository from '../../repositories/comment/commentRepository.js';
import logger from '../../utils/logger.js';
import { getPca } from '../../utils/pca.js';
import { getConversationInfo } from '../conversation/conversationService.js';
import { isTranslationEnabled, translateString } from '../translation/translationService.js';

/**
 * Get a comment by ID
 * @param {number} zid - Conversation ID
 * @param {number} tid - Comment ID
 * @returns {Promise<Object|null>} - Comment or null if not found
 */
async function getComment(zid, tid) {
  try {
    return await commentRepository.getCommentById(zid, tid);
  } catch (error) {
    logger.error('Error getting comment', error);
    throw error;
  }
}

/**
 * Get comments with various filters
 * @param {Object} options - Query options
 * @param {number} options.zid - Conversation ID
 * @param {boolean} [options.moderation] - Whether to get comments for moderation
 * @param {number} [options.pid] - Participant ID
 * @param {Array} [options.tids] - Comment IDs
 * @param {number} [options.mod] - Moderation status
 * @param {number} [options.mod_gt] - Moderation status greater than
 * @param {boolean} [options.modIn] - Moderation status in
 * @param {number} [options.not_voted_by_pid] - Not voted by participant ID
 * @param {Array} [options.withoutTids] - Exclude comment IDs
 * @param {boolean} [options.random] - Random order
 * @param {number} [options.limit] - Limit
 * @param {boolean} [options.include_voting_patterns] - Include voting patterns
 * @returns {Promise<Array>} - Comments
 */
async function getComments(options) {
  try {
    // Get conversation info
    const conversation = await getConversationInfo(options.zid);

    // Get comments based on moderation flag
    let comments;
    if (options.moderation) {
      // Check if strict moderation is enabled
      let strictModeration = false;
      if (options.modIn !== undefined) {
        strictModeration = conversation.strict_moderation;
      }

      // Get comments for moderation
      comments = await commentRepository.getCommentsForModeration({
        ...options,
        strict_moderation: strictModeration
      });
    } else {
      // Get regular comments list
      comments = await commentRepository.getCommentsList({
        ...options,
        strict_moderation: conversation.strict_moderation,
        prioritize_seed: conversation.prioritize_seed
      });
    }

    // Select and format columns
    const cols = ['txt', 'tid', 'created', 'uid', 'quote_src_url', 'anon', 'is_seed', 'is_meta', 'lang', 'pid'];

    if (options.moderation) {
      cols.push('velocity');
      cols.push('zid');
      cols.push('mod');
      cols.push('active');
      cols.push('agree_count');
      cols.push('disagree_count');
      cols.push('pass_count');
      cols.push('count');
    }

    // Format comments
    const formattedComments = comments.map((comment) => {
      const formattedComment = _.pick(comment, cols);

      // Convert count to number if defined
      if (formattedComment.count !== undefined) {
        formattedComment.count = Number(formattedComment.count);
      }

      return formattedComment;
    });

    // Remove sensitive information
    for (const comment of formattedComments) {
      comment.uid = undefined;
      comment.anon = undefined;
    }

    return formattedComments;
  } catch (error) {
    logger.error('Error getting comments', error);
    throw error;
  }
}

/**
 * Get comments for moderation
 * @param {Object} options - Query options
 * @returns {Promise<Array>} - Comments for moderation
 */
async function getCommentsForModeration(options) {
  try {
    // Check if strict moderation is enabled
    let strictModeration = false;
    if (options.modIn !== undefined) {
      const conversation = await getConversationInfo(options.zid);
      strictModeration = conversation.strict_moderation;
    }

    return await commentRepository.getCommentsForModeration({
      ...options,
      strict_moderation: strictModeration
    });
  } catch (error) {
    logger.error('Error getting comments for moderation', error);
    throw error;
  }
}

/**
 * Get comments list
 * @param {Object} options - Query options
 * @returns {Promise<Array>} - Comments list
 */
async function getCommentsList(options) {
  try {
    const conversation = await getConversationInfo(options.zid);

    return await commentRepository.getCommentsList({
      ...options,
      strict_moderation: conversation.strict_moderation,
      prioritize_seed: conversation.prioritize_seed
    });
  } catch (error) {
    logger.error('Error getting comments list', error);
    throw error;
  }
}

/**
 * Get number of comments remaining for a participant
 * @param {number} zid - Conversation ID
 * @param {number} pid - Participant ID
 * @returns {Promise<Object>} - Remaining comments info
 */
async function getNumberOfCommentsRemaining(zid, pid) {
  try {
    return await commentRepository.getNumberOfCommentsRemaining(zid, pid);
  } catch (error) {
    logger.error('Error getting number of comments remaining', error);
    throw error;
  }
}

/**
 * Translate and store a comment
 * @param {number} zid - Conversation ID
 * @param {number} tid - Comment ID
 * @param {string} text - Comment text
 * @param {string} targetLang - Target language code
 * @returns {Promise<Object|null>} - Stored translation or null if translation is disabled
 */
async function translateAndStoreComment(zid, tid, text, targetLang) {
  try {
    // Check if translation is enabled
    if (!isTranslationEnabled()) {
      return null;
    }

    // Translate the text
    const translation = await translateString(text, targetLang);

    // Store the translation
    return await commentRepository.storeCommentTranslation(zid, tid, translation, targetLang);
  } catch (error) {
    logger.error('Error translating and storing comment', error);
    throw error;
  }
}

/**
 * Select a comment probabilistically based on priorities
 * @param {Array} comments - Array of comments
 * @param {Object} priorities - Comment priorities
 * @param {number} _nTotal - Total number of comments (unused but kept for API compatibility)
 * @param {number} _nRemaining - Number of comments remaining (unused but kept for API compatibility)
 * @returns {Object} - Selected comment
 */
function selectProbabilistically(comments, priorities, _nTotal, _nRemaining) {
  const lookup = _.reduce(
    comments,
    (o, comment) => {
      const lookup_val = o.lastCount + (priorities[comment.tid] || 1);
      o.lookup.push([lookup_val, comment]);
      o.lastCount = lookup_val;
      return o;
    },
    { lastCount: 0, lookup: [] }
  );
  const randomN = Math.random() * lookup.lastCount;
  const result = _.find(lookup.lookup, (x) => x[0] > randomN);
  const c = result?.[1];
  c.randomN = randomN;
  return c;
}

/**
 * Get the next prioritized comment for a participant
 * @param {number} zid - Conversation ID
 * @param {number} pid - Participant ID
 * @param {Array} withoutTids - Comment IDs to exclude
 * @param {boolean} include_social - Include social information
 * @returns {Promise<Object|null>} - Next comment or null if none available
 */
async function getNextPrioritizedComment(zid, pid, withoutTids, include_social) {
  const params = {
    zid: zid,
    not_voted_by_pid: pid,
    include_social: include_social
  };

  if (!_.isUndefined(withoutTids) && withoutTids.length) {
    params.withoutTids = withoutTids;
  }

  try {
    const [comments, math, numberOfCommentsRemainingRows] = await Promise.all([
      getCommentsList(params),
      getPca(zid, 0),
      getNumberOfCommentsRemaining(zid, pid)
    ]);

    logger.debug('getNextPrioritizedComment intermediate results:', {
      zid,
      pid,
      numberOfCommentsRemainingRows
    });

    if (!comments || !comments.length) {
      return null;
    }

    if (!numberOfCommentsRemainingRows || !numberOfCommentsRemainingRows.length) {
      throw new Error(`polis_err_getNumberOfCommentsRemaining_${zid}_${pid}`);
    }

    const commentPriorities = math ? math.asPOJO['comment-priorities'] || {} : {};
    const nTotal = Number(numberOfCommentsRemainingRows[0].total);
    const nRemaining = Number(numberOfCommentsRemainingRows[0].remaining);
    const c = selectProbabilistically(comments, commentPriorities, nTotal, nRemaining);
    c.remaining = nRemaining;
    c.total = nTotal;
    return c;
  } catch (error) {
    logger.error('Error in getNextPrioritizedComment', error);
    throw error;
  }
}

/**
 * Get the next comment for a participant, with translations if needed
 * @param {number} zid - Conversation ID
 * @param {number} pid - Participant ID
 * @param {Array} withoutTids - Comment IDs to exclude
 * @param {boolean} include_social - Include social information
 * @param {string} lang - Language code
 * @returns {Promise<Object|null>} - Next comment or null if none available
 */
async function getNextComment(zid, pid, withoutTids, include_social, lang) {
  try {
    const c = await getNextPrioritizedComment(zid, pid, withoutTids, include_social);

    if (lang && c) {
      const firstTwoCharsOfLang = lang.substr(0, 2);
      const translations = await commentRepository.getCommentTranslations(zid, c.tid);
      c.translations = translations;

      const hasMatch = _.some(translations, (t) => {
        return t.lang.startsWith(firstTwoCharsOfLang);
      });

      if (!hasMatch) {
        const translation = await translateAndStoreComment(zid, c.tid, c.txt, lang);
        if (translation) {
          c.translations.push(translation);
        }
      }
    } else if (c) {
      c.translations = [];
    }

    return c;
  } catch (error) {
    logger.error('Error in getNextComment', error);
    throw error;
  }
}

export {
  getComment,
  getComments,
  getCommentsForModeration,
  getCommentsList,
  getNumberOfCommentsRemaining,
  translateAndStoreComment,
  getNextPrioritizedComment,
  getNextComment
};
