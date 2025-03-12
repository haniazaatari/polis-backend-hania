/**
 * Participants Utility Module
 * Contains utility functions for working with participants
 */
import Config from '../config.js';
import * as pg from '../db/pg-query.js';
import { queryP_readOnly as pgQueryP_readOnly } from '../db/pg-query.js';
import { isConversationOwner } from '../services/zinvite/zinviteService.js';
import logger from './logger.js';
import { getPca } from './pca.js';

/**
 * Gets the mapping from bid index to participant ID
 * @param {number} zid - Conversation ID
 * @param {number} [math_tick=-1] - Math tick for caching
 * @returns {Promise<Object|Error>} - Mapping data or error
 */
async function getBidIndexToPidMapping(zid, math_tick = -1) {
  try {
    const rows = await pgQueryP_readOnly('select * from math_bidtopid where zid = ($1) and math_env = ($2);', [
      zid,
      Config.mathEnv
    ]);

    if (!rows || !rows.length) {
      return new Error('polis_err_get_pca_results_missing');
    }

    if (rows[0].data.math_tick <= math_tick) {
      return new Error('polis_err_get_pca_results_not_new');
    }

    return rows[0].data;
  } catch (error) {
    logger.error('Error getting bid index to pid mapping', { error, zid, math_tick });
    throw error;
  }
}

/**
 * Gets participant IDs for a group ID
 * @param {number} zid - Conversation ID
 * @param {number} gid - Group ID
 * @param {number} math_tick - Math tick for caching
 * @returns {Promise<Array>} - Array of participant IDs
 */
async function getPidsForGid(zid, gid, math_tick) {
  try {
    const [pcaResult, bidToPidMapping] = await Promise.all([
      getPca(zid, math_tick),
      getBidIndexToPidMapping(zid, math_tick)
    ]);

    if (!pcaResult || !pcaResult.asPOJO) {
      return [];
    }

    const pojo = pcaResult.asPOJO;
    const clusters = pojo['group-clusters'];
    const indexToBid = pojo['base-clusters'].id;

    // Create a mapping from bid to index
    const bidToIndex = [];
    for (let i = 0; i < indexToBid.length; i++) {
      bidToIndex[indexToBid[i]] = i;
    }

    const indexToPids = bidToPidMapping.bidToPid;
    const cluster = clusters[gid];

    if (!cluster) {
      return [];
    }

    // Get all pids for the cluster members
    const members = cluster.members;
    let pids = [];

    for (let i = 0; i < members.length; i++) {
      const bid = members[i];
      const index = bidToIndex[bid];
      const morePids = indexToPids[index];
      Array.prototype.push.apply(pids, morePids);
    }

    // Convert to numbers and sort
    pids = pids.map((x) => Number.parseInt(x));
    pids.sort((a, b) => a - b);

    return pids;
  } catch (error) {
    logger.error('Error getting pids for gid', { error, zid, gid, math_tick });
    return [];
  }
}

/**
 * Gets a participant by user ID and conversation ID
 * @param {number} zid - Conversation ID
 * @param {number} uid - User ID
 * @returns {Promise<Object|null>} - Participant object or null if not found
 */
async function getParticipantByUid(zid, uid) {
  try {
    const rows = await pg.queryP_readOnly('SELECT * FROM participants WHERE zid = ($1) AND uid = ($2);', [zid, uid]);

    return rows.length ? rows[0] : null;
  } catch (err) {
    logger.error('Error getting participant by uid', err);
    throw err;
  }
}

/**
 * Gets a participant by participant ID
 * @param {number} pid - Participant ID
 * @returns {Promise<Object|null>} - Participant object or null if not found
 */
async function getParticipantByPid(pid) {
  try {
    const rows = await pg.queryP_readOnly('SELECT * FROM participants WHERE pid = ($1);', [pid]);

    return rows.length ? rows[0] : null;
  } catch (err) {
    logger.error('Error getting participant by pid', err);
    throw err;
  }
}

/**
 * Creates a new participant
 * @param {number} zid - Conversation ID
 * @param {number} uid - User ID
 * @param {Object} [metadata] - Optional metadata
 * @returns {Promise<Object>} - The created participant
 */
async function createParticipant(zid, uid, metadata = {}) {
  try {
    const rows = await pg.queryP('INSERT INTO participants (zid, uid, created) VALUES ($1, $2, now()) RETURNING *;', [
      zid,
      uid
    ]);

    const participant = rows[0];

    // Add metadata if provided
    if (Object.keys(metadata).length > 0) {
      await updateParticipantMetadata(participant.pid, metadata);
    }

    return participant;
  } catch (err) {
    logger.error('Error creating participant', err);
    throw err;
  }
}

/**
 * Updates participant metadata
 * @param {number} pid - Participant ID
 * @param {Object} metadata - Metadata to update
 * @returns {Promise<void>}
 */
async function updateParticipantMetadata(pid, metadata) {
  try {
    const keys = Object.keys(metadata);
    if (!keys.length) return;

    const sets = keys.map((key, i) => `${key} = ($${i + 2})`).join(', ');
    const values = keys.map((key) => metadata[key]);

    await pg.queryP(`UPDATE participants SET ${sets} WHERE pid = ($1);`, [pid, ...values]);
  } catch (err) {
    logger.error('Error updating participant metadata', err);
    throw err;
  }
}

/**
 * Pulls xInfo into subobjects for better organization
 * @param {Object} ptptoiRecord - The participant record
 * @returns {Object} The participant record with xInfo organized
 */
function pullXInfoIntoSubObjects(ptptoiRecord) {
  // Create a new object with only the non-x properties
  const result = {};
  const xInfo = {};
  let hasXInfo = false;

  // Copy all properties, separating x-related ones
  const keys = Object.keys(ptptoiRecord);
  for (const key of keys) {
    if (key === 'x_profile_image_url' || key === 'xid' || key === 'x_name' || key === 'x_email') {
      xInfo[key] = ptptoiRecord[key];
      hasXInfo = true;
    } else {
      result[key] = ptptoiRecord[key];
    }
  }

  // Only add xInfo if we found x-related properties
  if (hasXInfo) {
    result.xInfo = xInfo;
  }

  return result;
}

/**
 * Checks if a user is the owner of or a participant in a conversation
 * @param {number} zid - Conversation ID
 * @param {number} uid - User ID
 * @returns {Promise<boolean>} - True if the user is the owner or a participant
 */
async function isOwnerOrParticipant(zid, uid) {
  try {
    // Check if user is the owner
    const isOwner = await isConversationOwner(zid, uid);
    if (isOwner) {
      return true;
    }

    // Check if user is a participant
    const participant = await getParticipantByUid(zid, uid);
    return !!participant;
  } catch (err) {
    logger.error('Error checking if user is owner or participant', { error: err, zid, uid });
    throw err;
  }
}

export {
  createParticipant,
  getBidIndexToPidMapping,
  getParticipantByPid,
  getParticipantByUid,
  getPidsForGid,
  updateParticipantMetadata,
  pullXInfoIntoSubObjects,
  isOwnerOrParticipant
};
