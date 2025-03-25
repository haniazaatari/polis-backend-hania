import { queryP } from './pg-query.js';

/**
 * Generate and replace a zinvite for a conversation
 * @param {string} zinvite - New zinvite value
 * @param {number} zid - Conversation ID
 * @returns {Promise<void>}
 */
async function replaceZinvite(zinvite, zid) {
  await queryP('update zinvites set zinvite = ($1) where zid = ($2);', [zinvite, zid]);
}

/**
 * Create a single-use invite record
 * @param {string} suzinvite - Single-use zinvite
 * @param {string} xid - External ID
 * @param {number} zid - Conversation ID
 * @param {number} owner - Owner ID
 * @returns {Promise<void>}
 */
async function createSuzinvite(suzinvite, xid, zid, owner) {
  await queryP('INSERT INTO suzinvites (suzinvite, xid, zid, owner) VALUES ($1, $2, $3, $4);', [
    suzinvite,
    xid,
    zid,
    owner
  ]);
}

export { replaceZinvite, createSuzinvite };
