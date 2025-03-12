import _ from 'underscore';
import Config from '../../config.js';
import { queryP } from '../../db/pg-query.js';
import logger from '../../utils/logger.js';
import { generateRandomToken } from '../auth/tokenService.js';
import { getZinvite } from '../zinvite/zinviteService.js';

const serverUrl = Config.getServerNameWithProtocol();

/**
 * Add conversation IDs to conversation objects
 * @param {Array} conversations - Array of conversation objects
 * @returns {Promise<Array>} - Conversations with IDs added
 */
async function addConversationIds(conversations) {
  const zids = conversations.map((c) => c.zid);
  const zid2conversation_id = {};

  // Get all zinvites in parallel
  await Promise.all(
    zids.map(async (zid) => {
      try {
        const zinvite = await getZinvite(zid);
        zid2conversation_id[zid] = zinvite;
      } catch (err) {
        // If we can't find a zinvite, just skip this conversation
        logger.error(`Couldn't find zinvite for zid ${zid}:`, err);
      }
    })
  );

  // Add the conversation_id to each conversation
  return conversations.map((c) => {
    return {
      ...c,
      conversation_id: zid2conversation_id[c.zid]
    };
  });
}

/**
 * Generate a conversation URL prefix (used for suzinvites)
 * @returns {string} - A random digit between 2 and 9
 */
function generateConversationURLPrefix() {
  return `${_.random(2, 9)}`;
}

/**
 * Generate single-use zinvites
 * @param {number} numTokens - Number of tokens to generate
 * @returns {Promise<Array<string>>} - Array of suzinvites
 */
async function generateSUZinvites(numTokens) {
  try {
    const longStringOfTokens = await generateRandomToken(31 * numTokens, true);
    if (!longStringOfTokens) {
      throw new Error('polis_err_creating_otzinvite');
    }

    const matches = longStringOfTokens.match(/.{1,31}/g);
    if (!matches) {
      throw new Error('polis_err_creating_otzinvite');
    }

    let otzinviteArray = matches.slice(0, numTokens);
    otzinviteArray = otzinviteArray.map((suzinvite) => generateConversationURLPrefix() + suzinvite);
    return otzinviteArray;
  } catch (_err) {
    throw new Error('polis_err_creating_otzinvite');
  }
}

/**
 * Generate a single-use URL for a conversation
 * @param {string} conversation_id - Conversation ID
 * @param {string} suzinvite - Single-use zinvite
 * @returns {string} - Single-use URL
 */
function generateSingleUseUrl(conversation_id, suzinvite) {
  return `${serverUrl}/ot/${conversation_id}/${suzinvite}`;
}

/**
 * Create a single-use invite URL
 * @param {string} xid - External ID
 * @param {number} zid - Conversation ID
 * @param {number} owner - Owner ID
 * @returns {Promise<Object>} - Object with single-use URL
 */
async function createOneSuzinvite(xid, zid, owner) {
  const suzinviteArray = await generateSUZinvites(1);
  const suzinvite = suzinviteArray[0];

  await queryP('INSERT INTO suzinvites (suzinvite, xid, zid, owner) VALUES ($1, $2, $3, $4);', [
    suzinvite,
    xid,
    zid,
    owner
  ]);

  const conversation_id = await getZinvite(zid);

  return {
    zid: zid,
    conversation_id: conversation_id,
    suurl: generateSingleUseUrl(conversation_id, suzinvite)
  };
}

/**
 * Build a conversation URL
 * @param {string} conversation_id - Conversation ID
 * @returns {string} - Conversation URL
 */
function buildConversationUrl(conversation_id) {
  return `${serverUrl}/${conversation_id}`;
}

/**
 * Build a conversation demo URL
 * @param {string} conversation_id - Conversation ID
 * @returns {string} - Conversation demo URL
 */
function buildConversationDemoUrl(conversation_id) {
  return `${serverUrl}/demo/${conversation_id}`;
}

/**
 * Build a moderation URL
 * @param {string} conversation_id - Conversation ID
 * @returns {string} - Moderation URL
 */
function buildModerationUrl(conversation_id) {
  return `${serverUrl}/m/${conversation_id}`;
}

/**
 * Build a seed URL
 * @param {string} conversation_id - Conversation ID
 * @returns {string} - Seed URL
 */
function buildSeedUrl(conversation_id) {
  return `${buildModerationUrl(conversation_id)}/comments/seed`;
}

/**
 * Create a moderation URL
 * @param {string} conversation_id - Conversation ID
 * @returns {string} - Moderation URL
 */
function createModerationUrl(conversation_id) {
  return buildModerationUrl(conversation_id);
}

/**
 * Generate and replace a zinvite
 * @param {number} zid - Conversation ID
 * @param {boolean} generateShortZinvite - Whether to generate a short zinvite
 * @returns {Promise<string>} - The new zinvite
 */
async function generateAndReplaceZinvite(zid, generateShortZinvite) {
  let len = 12;
  if (generateShortZinvite) {
    len = 6;
  }

  try {
    const zinvite = await generateRandomToken(len, false);
    await queryP('update zinvites set zinvite = ($1) where zid = ($2);', [zinvite, zid]);
    return zinvite;
  } catch (err) {
    if (err.message === 'polis_err_generating_token') {
      throw new Error('polis_err_creating_zinvite');
    }
    throw err;
  }
}

/**
 * Get a conversation URL
 * @param {number} zid - Conversation ID
 * @param {boolean} withParticipationPrefix - Whether to include participation prefix
 * @returns {Promise<string>} - Conversation URL
 */
async function getConversationUrl(zid, withParticipationPrefix) {
  const zinvite = await getZinvite(zid);
  const prefix = withParticipationPrefix ? 'p/' : '';
  return `${serverUrl}/${prefix}${zinvite}`;
}

export {
  addConversationIds,
  createOneSuzinvite,
  buildConversationUrl,
  buildConversationDemoUrl,
  buildModerationUrl,
  buildSeedUrl,
  createModerationUrl,
  generateAndReplaceZinvite,
  getConversationUrl,
  generateSingleUseUrl,
  generateSUZinvites,
  generateConversationURLPrefix
};
