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

export { getConversationInfo };
