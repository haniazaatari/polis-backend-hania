import { queryP, queryP_readOnly } from '../db/pg-query.js';

/**
 * Retrieves location data for participants in a conversation
 * @param {number} zid - The conversation ID
 * @returns {Promise<Array>} - Array of participant location records
 */
async function getLocationsForParticipants(zid) {
  return queryP_readOnly('select * from participant_locations where zid = ($1);', [zid]);
}

/**
 * Creates a new participant location record
 * @param {number} zid - The conversation ID
 * @param {number} uid - The user ID
 * @param {number} pid - The participant ID
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {string} source - Source of the location data
 * @returns {Promise<Object>} - The created location record
 */
async function createParticipantLocationRecord(zid, uid, pid, lat, lng, source) {
  return queryP(
    'INSERT INTO participant_locations (zid, uid, pid, lat, lng, source) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;',
    [zid, uid, pid, lat, lng, source]
  );
}

export { getLocationsForParticipants, createParticipantLocationRecord };
