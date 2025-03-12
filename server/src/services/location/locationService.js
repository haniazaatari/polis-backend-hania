import * as locationRepository from '../../repositories/locationRepository.js';
import logger from '../../utils/logger.js';
import { geoCode } from '../geocoding/geocodingService.js';

/**
 * Gets locations for all participants in a conversation
 * @param {number} zid - The conversation ID
 * @returns {Promise<Array>} - Array of participant location records
 */
async function getLocationsForParticipants(zid) {
  return locationRepository.getLocationsForParticipants(zid);
}

/**
 * Creates a location record for a participant using geocoded location
 * @param {number} zid - The conversation ID
 * @param {number} uid - The user ID
 * @param {number} pid - The participant ID
 * @param {string} locationString - The location string to geocode
 * @returns {Promise<Object>} - The created location record
 */
async function createParticipantLocationFromString(zid, uid, pid, locationString) {
  try {
    const { lat, lng } = await geoCode(locationString);
    return locationRepository.createParticipantLocationRecord(zid, uid, pid, lat, lng, 'user_provided');
  } catch (error) {
    logger.error(`Error creating location from string: ${error.message}`);
    throw error;
  }
}

/**
 * Creates a location record for a participant using provided coordinates
 * @param {number} zid - The conversation ID
 * @param {number} uid - The user ID
 * @param {number} pid - The participant ID
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {string} source - Source of the location data
 * @returns {Promise<Object>} - The created location record
 */
async function createParticipantLocation(zid, uid, pid, lat, lng, source) {
  return locationRepository.createParticipantLocationRecord(zid, uid, pid, lat, lng, source);
}

export { getLocationsForParticipants, createParticipantLocationFromString, createParticipantLocation };
