import LruCache from 'lru-cache';
import _ from 'underscore';
import { updateConversationModifiedTime as updateModifiedTime } from '../../db/conversationUpdates.js';
import * as pg from '../../db/pg-query.js';
import { sql_conversations } from '../../db/sql.js';
import logger from '../../utils/logger.js';

// Cache for conversation ID to ZID mapping
const conversationIdToZidCache = new LruCache({
  max: 1000
});

/**
 * Get conversation information by ZID
 * @param {number} zid - Conversation ID (ZID)
 * @returns {Promise<Object|null>} - Conversation information or null if not found
 */
async function getConversationByZid(zid) {
  try {
    const results = await pg.queryP_readOnly('SELECT * FROM conversations WHERE zid = ($1);', [zid]);
    return results.length ? results[0] : null;
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
    const results = await pg.queryP_readOnly(
      'SELECT * FROM conversations WHERE zid = (SELECT zid FROM zinvites WHERE zinvite = ($1));',
      [conversationId]
    );
    return results.length ? results[0] : null;
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
  // Check cache first
  const cachedZid = conversationIdToZidCache.get(conversationId);
  if (cachedZid) {
    return cachedZid;
  }

  try {
    const results = await pg.queryP_readOnly('SELECT zid FROM zinvites WHERE zinvite = ($1);', [conversationId]);

    if (!results || !results.length) {
      throw new Error('polis_err_fetching_zid_for_conversation_id');
    }

    const zid = results[0].zid;
    conversationIdToZidCache.set(conversationId, zid);
    return zid;
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
    await pg.queryP('INSERT INTO zinvites (zid, zinvite, created) VALUES ($1, $2, default);', [zid, zinvite]);
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
  const query = sql_conversations.update(fields).where(sql_conversations.zid.equals(zid)).returning('*');

  const result = await pg.queryP(query.toString());
  return result.rows[0];
}

/**
 * Update the modified time of a conversation
 * @param {number} zid - Conversation ID
 * @param {number} [modified] - Optional custom modified time
 * @returns {Promise<void>}
 */
async function updateConversationModifiedTime(zid, modified) {
  // Use the implementation from conversationUpdates.js
  return updateModifiedTime(zid, modified);
}

/**
 * Get participant information for a user
 * @param {number} uid - User ID
 * @param {boolean} includeAllConversationsIAmIn - Whether to include all conversations the user is in
 * @returns {Promise<Object>} - Participant information
 */
async function getParticipantInfo(uid, includeAllConversationsIAmIn) {
  try {
    let participantInOrSiteAdminOf = [];
    let isSiteAdmin = {};

    if (uid && includeAllConversationsIAmIn) {
      const results = await pg.queryP_readOnly('SELECT zid, is_mod FROM participants WHERE uid = ($1);', [uid]);

      if (results?.length) {
        participantInOrSiteAdminOf = results.map((p) => p.zid);
        isSiteAdmin = results.reduce((o, p) => {
          o[p.zid] = p.is_mod;
          return o;
        }, {});
      }
    }

    return {
      participantInOrSiteAdminOf,
      isSiteAdmin
    };
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
  let query = sql_conversations.select(sql_conversations.star());
  let isRootsQuery = false;
  let orClauses;

  // Build WHERE clauses
  if (!_.isUndefined(options.context)) {
    if (options.context === '/') {
      orClauses = sql_conversations.is_public.equals(true);
      isRootsQuery = true;
    } else {
      orClauses = sql_conversations.context.equals(options.context);
    }
  } else {
    orClauses = sql_conversations.owner.equals(options.uid);
    if (options.participantInOrSiteAdminOf?.length) {
      orClauses = orClauses.or(sql_conversations.zid.in(options.participantInOrSiteAdminOf));
    }
  }

  query = query.where(orClauses);

  // Add additional filters
  if (!_.isUndefined(options.courseInvite)) {
    query = query.and(sql_conversations.course_id.equals(options.courseId));
  }

  if (!_.isUndefined(options.isActive)) {
    query = query.and(sql_conversations.is_active.equals(options.isActive));
  }

  if (!_.isUndefined(options.isDraft)) {
    query = query.and(sql_conversations.is_draft.equals(options.isDraft));
  }

  if (!_.isUndefined(options.zid)) {
    query = query.and(sql_conversations.zid.equals(options.zid));
  }

  if (isRootsQuery) {
    query = query.and(sql_conversations.context.isNotNull());
  }

  // Order and limit
  query = query.order(sql_conversations.created.descending);
  query = query.limit(options.limit || 999);

  const result = await pg.queryP_readOnly(query.toString());
  return result.rows || [];
}

/**
 * Verify metadata answers exist for each question
 * @param {number} zid - Conversation ID
 * @returns {Promise<void>}
 */
async function verifyMetadataAnswersExistForEachQuestion(zid) {
  const errorcode = 'polis_err_missing_metadata_answers';

  // Query for question IDs from participant_metadata_questions
  const questionsResult = await pg.queryP_readOnly(
    'SELECT pmqid FROM participant_metadata_questions WHERE zid = ($1);',
    [zid]
  );

  // If no questions found, resolve successfully
  if (!questionsResult || !questionsResult.rows || !questionsResult.rows.length) {
    return;
  }

  // Extract question IDs
  const pmqids = questionsResult.rows.map((row) => Number(row.pmqid));

  // Query for answers that match these question IDs
  const answersResult = await pg.queryP_readOnly(
    `SELECT pmaid, pmqid FROM participant_metadata_answers WHERE pmqid IN (${pmqids.join(',')}) AND alive = TRUE AND zid = ($1);`,
    [zid]
  );

  // If no answers found at all, throw error
  if (!answersResult || !answersResult.rows || !answersResult.rows.length) {
    throw new Error(errorcode);
  }

  // Create a dictionary of all question IDs
  const questions = {};
  for (const pmqid of pmqids) {
    questions[pmqid] = 1;
  }

  // Remove questions that have answers
  for (const row of answersResult.rows) {
    delete questions[row.pmqid];
  }

  // If any questions remain (no answers for them), throw error
  if (Object.keys(questions).length) {
    throw new Error(errorcode);
  }
}

/**
 * Check if a user is a developer (admin)
 * @param {number} uid - User ID
 * @returns {Promise<boolean>} - Whether the user is a developer
 */
async function isUserDeveloper(uid) {
  try {
    const results = await pg.queryP_readOnly('SELECT * FROM users WHERE uid = ($1) AND is_polis_admin = TRUE;', [uid]);
    return results.length > 0;
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
    const results = await pg.queryP_readOnly(`SELECT * FROM conversations WHERE ${field} >= ($1);`, [value]);
    return results;
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
    const args = [zid];
    const query = until
      ? 'SELECT created, pid, mod FROM comments WHERE zid = ($1) AND created < ($2) ORDER BY created;'
      : 'SELECT created, pid, mod FROM comments WHERE zid = ($1) ORDER BY created;';

    if (until) {
      args.push(until);
    }

    const results = await pg.queryP_readOnly(query, args);
    return results;
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
    const args = [zid];
    const query = until
      ? 'SELECT created, pid FROM votes WHERE zid = ($1) AND created < ($2) ORDER BY created;'
      : 'SELECT created, pid FROM votes WHERE zid = ($1) ORDER BY created;';

    if (until) {
      args.push(until);
    }

    const results = await pg.queryP_readOnly(query, args);
    return results;
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
    const query = 'SELECT * FROM conversations WHERE zid = ($1) AND owner = ($2);';
    const results = await pg.queryP_readOnly(query, [zid, uid]);
    return results.length ? results[0] : null;
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
    await pg.queryP('UPDATE conversations SET is_active = ($1) WHERE zid = ($2);', [isActive, zid]);
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
    const query = sql_conversations.insert(conversationData).returning('*').toString();
    const results = await pg.queryP(query, []);
    return results[0];
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
    const results = await pg.queryP_readOnly('SELECT uid FROM users WHERE site_id = ($1) AND site_owner = TRUE;', [
      site_id
    ]);
    return results.length ? results[0] : null;
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
    await pg.queryP('INSERT INTO page_ids (site_id, page_id, zid) VALUES ($1, $2, $3);', [site_id, page_id, zid]);
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
    const results = await pg.queryP_readOnly('SELECT * FROM page_ids WHERE site_id = ($1) AND page_id = ($2);', [
      site_id,
      page_id
    ]);
    return results.length ? results[0] : null;
  } catch (error) {
    logger.error('Error getting page ID', error);
    throw error;
  }
}

export {
  conversationIdToZidCache,
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
