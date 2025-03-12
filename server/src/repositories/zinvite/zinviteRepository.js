/**
 * Zinvite Repository
 * Handles database operations for zinvites (conversation invitations)
 */
import LruCache from 'lru-cache';
import { queryP, queryP_readOnly } from '../../db/pg-query.js';

// Cache for mapping zids to zinvites
const zidToZinviteCache = new LruCache({
  max: 1000
});

/**
 * Get the owner of a conversation
 * @param {number} zid - Conversation ID
 * @param {number} uid - User ID
 * @returns {Promise<Array>} - Array of conversation objects
 */
async function getConversationOwner(zid, uid) {
  return queryP_readOnly('SELECT * FROM conversations WHERE zid = ($1) AND owner = ($2);', [zid, uid]);
}

/**
 * Get all zinvites for a conversation
 * @param {number} zid - Conversation ID
 * @returns {Promise<Array>} - Array of zinvite objects
 */
async function getZinvitesForConversation(zid) {
  return queryP_readOnly('SELECT * FROM zinvites WHERE zid = ($1);', [zid]);
}

/**
 * Create a new zinvite
 * @param {number} zid - Conversation ID
 * @param {string} zinvite - Zinvite code
 * @returns {Promise<void>}
 */
async function createZinvite(zid, zinvite) {
  await queryP('INSERT INTO zinvites (zid, zinvite, created) VALUES ($1, $2, default);', [zid, zinvite]);

  // Update the cache
  zidToZinviteCache.set(zid, zinvite);
}

/**
 * Update an existing zinvite
 * @param {number} zid - Conversation ID
 * @param {string} zinvite - New zinvite code
 * @returns {Promise<void>}
 */
async function updateZinvite(zid, zinvite) {
  await queryP('UPDATE zinvites SET zinvite = ($1) WHERE zid = ($2);', [zinvite, zid]);

  // Update the cache
  zidToZinviteCache.set(zid, zinvite);
}

/**
 * Get a zinvite for a conversation
 * @param {number} zid - Conversation ID
 * @param {boolean} dontUseCache - Whether to bypass the cache
 * @returns {Promise<string>} - The zinvite code
 */
async function getZinvite(zid, dontUseCache = false) {
  // Check the cache first
  const cachedZinvite = zidToZinviteCache.get(zid);
  if (!dontUseCache && cachedZinvite) {
    return cachedZinvite;
  }

  // Query the database
  const rows = await queryP_readOnly('SELECT * FROM zinvites WHERE zid = ($1);', [zid]);
  const zinvite = rows?.[0]?.zinvite;

  // Update the cache
  if (zinvite) {
    zidToZinviteCache.set(zid, zinvite);
  }

  return zinvite;
}

/**
 * Get zinvites for multiple conversations
 * @param {Array<number>} zids - Array of conversation IDs
 * @returns {Promise<Object>} - Object mapping zids to zinvites
 */
async function getZinvites(zids) {
  if (!zids.length) {
    return {};
  }

  // Convert zids to numbers and remove duplicates
  const zidsAsNumbers = zids.map((zid) => Number(zid));
  const uniqueZids = [...new Set(zidsAsNumbers)];

  // Check which zids are in the cache
  const uncachedZids = uniqueZids.filter((zid) => !zidToZinviteCache.get(zid));
  const zidsWithCachedZinvites = uniqueZids
    .filter((zid) => !!zidToZinviteCache.get(zid))
    .map((zid) => ({
      zid: zid,
      zinvite: zidToZinviteCache.get(zid)
    }));

  // If all zids are in the cache, return the cached values
  if (uncachedZids.length === 0) {
    return makeZidToZinviteMap([zidsWithCachedZinvites]);
  }

  // Query the database for uncached zids
  return new Promise((resolve, reject) => {
    queryP_readOnly(`SELECT * FROM zinvites WHERE zid IN (${uncachedZids.join(',')});`, [])
      .then((rows) => {
        resolve(makeZidToZinviteMap([rows, zidsWithCachedZinvites]));
      })
      .catch((err) => {
        reject(err);
      });
  });
}

/**
 * Helper function to create a map of zids to zinvites
 * @param {Array<Array>} arrays - Arrays of objects with zid and zinvite properties
 * @returns {Object} - Object mapping zids to zinvites
 */
function makeZidToZinviteMap(arrays) {
  const zid2zinvite = {};
  for (const array of arrays) {
    for (const item of array) {
      zid2zinvite[item.zid] = item.zinvite;

      // Update the cache
      zidToZinviteCache.set(item.zid, item.zinvite);
    }
  }
  return zid2zinvite;
}

/**
 * Check if a zinvite code is valid for a conversation
 * @param {number} zid - Conversation ID
 * @param {string} zinvite - Zinvite code
 * @returns {Promise<boolean>} - True if the zinvite is valid, false otherwise
 */
async function checkZinviteValidity(zid, zinvite) {
  const rows = await queryP_readOnly('SELECT * FROM zinvites WHERE zid = ($1) AND zinvite = ($2);', [zid, zinvite]);
  return rows && rows.length > 0;
}

/**
 * Check if a single-use zinvite code is valid for a conversation
 * @param {number} zid - Conversation ID
 * @param {string} suzinvite - Single-use zinvite code
 * @returns {Promise<boolean>} - True if the suzinvite is valid, false otherwise
 */
async function checkSuzinviteValidity(zid, suzinvite) {
  const rows = await queryP_readOnly('SELECT * FROM suzinvites WHERE zid = ($1) AND suzinvite = ($2);', [
    zid,
    suzinvite
  ]);
  return rows && rows.length > 0;
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
