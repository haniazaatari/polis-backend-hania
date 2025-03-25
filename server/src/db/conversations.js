import LruCache from 'lru-cache';
import _ from 'underscore';
import logger from '../utils/logger.js';
import { queryP, queryP_readOnly } from './pg-query.js';
import { sql_conversations } from './sql.js';

// Cache for conversation ID to ZID mapping
const conversationIdToZidCache = new LruCache({
  max: 1000
});

/**
 * Get information about a conversation
 * @param {number} zid - The conversation ID
 * @returns {Promise<Object>} - The conversation information
 */
async function getConversationInfo(zid) {
  const rows = await queryP_readOnly('SELECT * FROM conversations WHERE zid = $1;', [zid]);

  if (!rows?.length) {
    throw new Error(`Conversation not found: ${zid}`);
  }

  return rows[0];
}

/**
 * Get conversation information by ZID
 * @param {number} zid - Conversation ID (ZID)
 * @returns {Promise<Object|null>} - Conversation information or null if not found
 */
async function getConversationByZid(zid) {
  const results = await queryP_readOnly('SELECT * FROM conversations WHERE zid = ($1);', [zid]);
  return results.length ? results[0] : null;
}

/**
 * Get conversation information by conversation ID (zinvite)
 * @param {string} conversationId - Conversation ID (zinvite)
 * @returns {Promise<Object|null>} - Conversation information or null if not found
 */
async function getConversationByConversationId(conversationId) {
  const results = await queryP_readOnly(
    'SELECT * FROM conversations WHERE zid = (SELECT zid FROM zinvites WHERE zinvite = ($1));',
    [conversationId]
  );
  return results.length ? results[0] : null;
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

  logger.debug(`Looking up ZID for conversation ID: ${conversationId}`);
  const results = await queryP_readOnly('SELECT zid FROM zinvites WHERE zinvite = ($1);', [conversationId]);
  logger.debug(`Results: ${JSON.stringify(results)}`);

  // Check if the results array is empty
  if (!results || results.length === 0) {
    logger.error(`No results found for conversation ID: ${conversationId}`);
    throw new Error('polis_err_fetching_zid_for_conversation_id');
  }

  // The results are an array of objects
  const zid = results[0].zid;
  logger.debug(`Found ZID ${zid} for conversation ID: ${conversationId}`);
  conversationIdToZidCache.set(conversationId, zid);
  return zid;
}

/**
 * Update a conversation
 * @param {number} zid - Conversation ID
 * @param {Object} fields - Fields to update
 * @returns {Promise<Object>} - Updated conversation
 */
async function updateConversation(zid, fields) {
  // Only proceed with update if there are fields to update
  if (Object.keys(fields).length === 0) {
    // If no fields to update, fetch and return the current conversation
    return getConversationByZid(zid);
  }

  const query = sql_conversations.update(fields).where(sql_conversations.zid.equals(zid)).returning('*');
  const result = await queryP(query.toString());

  // Check if result is empty array
  if (!result || result.length === 0) {
    throw new Error(`Conversation with zid ${zid} not found or could not be updated`);
  }

  return result[0];
}

/**
 * Get participant information for a user
 * @param {number} uid - User ID
 * @param {boolean} includeAllConversationsIAmIn - Whether to include all conversations the user is in
 * @returns {Promise<Object>} - Participant information
 */
async function getParticipantInfo(uid, includeAllConversationsIAmIn) {
  let participantInOrSiteAdminOf = [];
  let isSiteAdmin = {};

  if (uid && includeAllConversationsIAmIn) {
    const results = await queryP_readOnly('SELECT zid, mod FROM participants WHERE uid = ($1);', [uid]);

    if (results?.length) {
      participantInOrSiteAdminOf = results.map((p) => p.zid);
      isSiteAdmin = results.reduce((o, p) => {
        o[p.zid] = p.mod;
        return o;
      }, {});
    }
  }

  return {
    participantInOrSiteAdminOf,
    isSiteAdmin
  };
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

  logger.debug('Building getConversations query with options', options);

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

  const queryString = query.toString();
  logger.debug('Final SQL query for getConversations', { query: queryString });

  const result = await queryP_readOnly(queryString);
  logger.debug('Query result for getConversations', {
    count: Array.isArray(result) ? result.length : 0
  });

  return result || [];
}

/**
 * Verify metadata answers exist for each question
 * @param {number} zid - Conversation ID
 * @returns {Promise<void>}
 */
async function verifyMetadataAnswersExistForEachQuestion(zid) {
  const errorcode = 'polis_err_missing_metadata_answers';

  // Query for question IDs from participant_metadata_questions
  const questionsResult = await queryP_readOnly('SELECT pmqid FROM participant_metadata_questions WHERE zid = ($1);', [
    zid
  ]);

  // If no questions found, resolve successfully
  if (!questionsResult || questionsResult.length === 0) {
    return;
  }

  // Extract question IDs
  const pmqids = questionsResult.map((row) => Number(row.pmqid));

  // Query for answers that match these question IDs
  const answersResult = await queryP_readOnly(
    `SELECT pmaid, pmqid FROM participant_metadata_answers WHERE pmqid IN (${pmqids.join(',')}) AND alive = TRUE AND zid = ($1);`,
    [zid]
  );

  // If no answers found at all, throw error
  if (!answersResult || answersResult.length === 0) {
    throw new Error(errorcode);
  }

  // Create a dictionary of all question IDs
  const questions = {};
  for (const pmqid of pmqids) {
    questions[pmqid] = 1;
  }

  // Remove questions that have answers
  for (const row of answersResult) {
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
  const results = await queryP_readOnly('SELECT * FROM users WHERE uid = ($1) AND is_polis_admin = TRUE;', [uid]);
  return results.length > 0;
}

/**
 * Get conversations with a field greater than a specified value
 * @param {string} field - Field to filter by
 * @param {number} value - Value to filter by
 * @returns {Promise<Array>} - Array of conversations
 */
async function getConversationsWithFieldGreaterThan(field, value) {
  const results = await queryP_readOnly(`SELECT * FROM conversations WHERE ${field} >= ($1);`, [value]);
  return results;
}

/**
 * Get comments for conversation statistics
 * @param {number} zid - Conversation ID
 * @param {number} until - Timestamp to filter until
 * @returns {Promise<Array>} - Array of comments
 */
async function getCommentsForStats(zid, until) {
  const args = [zid];
  const query = until
    ? 'SELECT created, pid, mod FROM comments WHERE zid = ($1) AND created < ($2) ORDER BY created;'
    : 'SELECT created, pid, mod FROM comments WHERE zid = ($1) ORDER BY created;';

  if (until) {
    args.push(until);
  }

  return queryP_readOnly(query, args);
}

/**
 * Get votes for conversation statistics
 * @param {number} zid - Conversation ID
 * @param {number} until - Timestamp to filter until
 * @returns {Promise<Array>} - Array of votes
 */
async function getVotesForStats(zid, until) {
  const args = [zid];
  const query = until
    ? 'SELECT created, pid FROM votes WHERE zid = ($1) AND created < ($2) ORDER BY created;'
    : 'SELECT created, pid FROM votes WHERE zid = ($1) ORDER BY created;';

  if (until) {
    args.push(until);
  }

  return queryP_readOnly(query, args);
}

/**
 * Get conversation for owner
 * @param {number} zid - Conversation ID
 * @param {number} uid - User ID
 * @returns {Promise<Object|null>} - Conversation or null if not found
 */
async function getConversationForOwner(zid, uid) {
  const results = await queryP_readOnly('SELECT * FROM conversations WHERE zid = ($1) AND owner = ($2);', [zid, uid]);
  return results.length ? results[0] : null;
}

/**
 * Update conversation active status
 * @param {number} zid - Conversation ID
 * @param {boolean} isActive - Whether the conversation should be active
 * @returns {Promise<void>}
 */
async function updateConversationActive(zid, isActive) {
  await queryP('UPDATE conversations SET is_active = ($1) WHERE zid = ($2);', [isActive, zid]);
}

/**
 * Create a new conversation
 * @param {Object} conversationData - Conversation data
 * @returns {Promise<Object>} - Created conversation
 */
async function createConversation(conversationData) {
  const query = sql_conversations.insert(conversationData).returning('*').toString();
  const results = await queryP(query, []);
  return results[0];
}

/**
 * Get site owner by site ID
 * @param {string} site_id - Site ID
 * @returns {Promise<Object|null>} - Site owner or null if not found
 */
async function getSiteOwner(site_id) {
  const results = await queryP_readOnly('SELECT uid FROM users WHERE site_id = ($1) AND site_owner = TRUE;', [site_id]);
  return results.length ? results[0] : null;
}

/**
 * Register page ID
 * @param {string} site_id - Site ID
 * @param {string} page_id - Page ID
 * @param {number} zid - Conversation ID
 * @returns {Promise<void>}
 */
async function registerPageId(site_id, page_id, zid) {
  await queryP('INSERT INTO page_ids (site_id, page_id, zid) VALUES ($1, $2, $3);', [site_id, page_id, zid]);
}

/**
 * Get page ID
 * @param {string} site_id - Site ID
 * @param {string} page_id - Page ID
 * @returns {Promise<Object|null>} - Page ID info or null if not found
 */
async function getPageId(site_id, page_id) {
  const results = await queryP_readOnly('SELECT * FROM page_ids WHERE site_id = ($1) AND page_id = ($2);', [
    site_id,
    page_id
  ]);
  return results.length ? results[0] : null;
}

/**
 * Get conversation metadata questions
 * @param {number} zid - Conversation ID
 * @returns {Promise<Array>} Array of metadata questions
 */
async function getConversationMetadataQuestions(zid) {
  return await queryP_readOnly('SELECT * FROM participant_metadata_questions WHERE zid = ($1) AND alive = TRUE;', [
    zid
  ]);
}

/**
 * Get conversation translations
 * @param {number} zid - Conversation ID
 * @param {string} lang - Language code (first two chars will be used)
 * @returns {Promise<Array>} Array of translations
 */
async function getConversationTranslationsByLang(zid, lang) {
  const firstTwoCharsOfLang = lang.substring(0, 2);
  return await queryP_readOnly('SELECT * FROM conversation_translations WHERE zid = ($1) AND lang = ($2);', [
    zid,
    firstTwoCharsOfLang
  ]);
}

/**
 * Get conversation with owner info
 * @param {number} zid - Conversation ID
 * @returns {Promise<Object>} Conversation data with owner info
 */
async function getConversationWithOwner(zid) {
  return await queryP_readOnly(
    'select * from conversations left join (select uid, site_id from users) as u on conversations.owner = u.uid where conversations.zid = ($1);',
    [zid]
  );
}

/**
 * Get course by invite code
 * @param {string} courseInvite - Course invite code
 * @returns {Promise<Object>} Course data
 */
async function getCourseByInvite(courseInvite) {
  return await queryP_readOnly('select course_id from courses where course_invite = ($1);', [courseInvite]);
}

/**
 * Register a zinvite for a conversation
 * @param {number} zid - Conversation ID (ZID)
 * @param {string} zinvite - Zinvite code
 * @returns {Promise<void>}
 */
async function registerZinvite(zid, zinvite) {
  await queryP('INSERT INTO zinvites (zid, zinvite, created) VALUES ($1, $2, default);', [zid, zinvite]);
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
  verifyMetadataAnswersExistForEachQuestion,
  getConversationMetadataQuestions,
  getConversationTranslationsByLang,
  getConversationWithOwner,
  getCourseByInvite,
  getConversationInfo
};
