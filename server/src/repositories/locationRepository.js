import { createParticipantLocation, getParticipantLocations } from '../db/locations.js';

/**
 * Retrieves location data for participants in a conversation
 * @param {number} zid - The conversation ID
 * @returns {Promise<Array>} - Array of participant location records
 */
async function getLocationsForParticipants(zid) {
  return getParticipantLocations(zid);
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
  return createParticipantLocation(zid, uid, pid, lat, lng, source);
}

export { getLocationsForParticipants, createParticipantLocationRecord };
