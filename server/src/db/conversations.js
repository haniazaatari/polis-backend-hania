import { pgQueryP_readOnly } from './pg-query.js';

/**
 * Get information about a conversation
 * @param {number} zid - The conversation ID
 * @returns {Promise<Object>} - The conversation information
 */
async function getConversationInfo(zid) {
  const rows = await pgQueryP_readOnly('SELECT * FROM conversations WHERE zid = $1;', [zid]);

  if (!rows?.length) {
    throw new Error(`Conversation not found: ${zid}`);
  }

  return rows[0];
}

/**
 * Get conversation metadata questions
 * @param {number} zid - Conversation ID
 * @returns {Promise<Array>} Array of metadata questions
 */
async function getConversationMetadataQuestions(zid) {
  return await pgQueryP_readOnly('SELECT * FROM participant_metadata_questions WHERE zid = ($1) AND alive = TRUE;', [
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
  return await pgQueryP_readOnly('SELECT * FROM conversation_translations WHERE zid = ($1) AND lang = ($2);', [
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
  return await pgQueryP_readOnly(
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
  return await pgQueryP_readOnly('select course_id from courses where course_invite = ($1);', [courseInvite]);
}

export {
  getConversationInfo,
  getConversationMetadataQuestions,
  getConversationTranslationsByLang,
  getConversationWithOwner,
  getCourseByInvite
};
