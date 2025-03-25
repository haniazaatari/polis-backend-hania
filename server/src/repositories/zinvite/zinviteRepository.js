/**
 * Zinvite Repository
 * Handles database operations for zinvites (conversation invitations)
 */
import {
  checkSuzinviteValidity as dbCheckSuzinviteValidity,
  checkZinviteValidity as dbCheckZinviteValidity,
  createZinvite as dbCreateZinvite,
  getConversationOwner as dbGetConversationOwner,
  getZinvite as dbGetZinvite,
  getZinvites as dbGetZinvites,
  getZinvitesForConversation as dbGetZinvitesForConversation,
  updateZinvite as dbUpdateZinvite
} from '../../db/zinvites.js';

/**
 * Get the owner of a conversation
 * @param {number} zid - Conversation ID
 * @param {number} uid - User ID
 * @returns {Promise<Array>} - Array of conversation objects
 */
async function getConversationOwner(zid, uid) {
  return dbGetConversationOwner(zid, uid);
}

/**
 * Get all zinvites for a conversation
 * @param {number} zid - Conversation ID
 * @returns {Promise<Array>} - Array of zinvite objects
 */
async function getZinvitesForConversation(zid) {
  return dbGetZinvitesForConversation(zid);
}

/**
 * Create a new zinvite
 * @param {number} zid - Conversation ID
 * @param {string} zinvite - Zinvite code
 * @returns {Promise<void>}
 */
async function createZinvite(zid, zinvite) {
  return dbCreateZinvite(zid, zinvite);
}

/**
 * Update an existing zinvite
 * @param {number} zid - Conversation ID
 * @param {string} zinvite - New zinvite code
 * @returns {Promise<void>}
 */
async function updateZinvite(zid, zinvite) {
  return dbUpdateZinvite(zid, zinvite);
}

/**
 * Get a zinvite for a conversation
 * @param {number} zid - Conversation ID
 * @param {boolean} dontUseCache - Whether to bypass the cache
 * @returns {Promise<string>} - The zinvite code
 */
async function getZinvite(zid, dontUseCache = false) {
  return dbGetZinvite(zid, dontUseCache);
}

/**
 * Get zinvites for multiple conversations
 * @param {Array<number>} zids - Array of conversation IDs
 * @returns {Promise<Object>} - Object mapping zids to zinvites
 */
async function getZinvites(zids) {
  return dbGetZinvites(zids);
}

/**
 * Check if a zinvite code is valid for a conversation
 * @param {number} zid - Conversation ID
 * @param {string} zinvite - Zinvite code
 * @returns {Promise<boolean>} - True if the zinvite is valid, false otherwise
 */
async function checkZinviteValidity(zid, zinvite) {
  return dbCheckZinviteValidity(zid, zinvite);
}

/**
 * Check if a single-use zinvite code is valid for a conversation
 * @param {number} zid - Conversation ID
 * @param {string} suzinvite - Single-use zinvite code
 * @returns {Promise<boolean>} - True if the suzinvite is valid, false otherwise
 */
async function checkSuzinviteValidity(zid, suzinvite) {
  return dbCheckSuzinviteValidity(zid, suzinvite);
}

export {
  getConversationOwner,
  getZinvitesForConversation,
  createZinvite,
  updateZinvite,
  getZinvite,
  getZinvites,
  checkZinviteValidity,
  checkSuzinviteValidity
};
