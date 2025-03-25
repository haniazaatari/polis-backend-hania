import request from 'request-promise';
import Config from '../../config.js';

/**
 * Geocodes a location string using Google Maps API
 * @param {string} locationString - The location to geocode
 * @returns {Promise<Object>} - The geocoding result with lat/lng
 */
async function geoCodeWithGoogleApi(locationString) {
  const googleApiKey = Config.googleApiKey;
  const address = encodeURI(locationString);

  if (!googleApiKey) {
    throw new Error('polis_err_geocoding_no_api_key');
  }

  const response = await request.get(
    `https://maps.googleapis.com/maps/api/geocode/json?address=${address}&key=${googleApiKey}`
  );

  const responseData = JSON.parse(response);

  if (responseData.status !== 'OK') {
    throw new Error('polis_err_geocoding_failed');
  }

  const bestResult = responseData.results[0];
  return bestResult;
}

/**
 * Geocodes a location string and returns lat/lng coordinates
 * @param {string} locationString - The location to geocode
 * @returns {Promise<Object>} - Object containing lat and lng
 */
async function geoCode(locationString) {
  const result = await geoCodeWithGoogleApi(locationString);

  return {
    lat: result.geometry.location.lat,
    lng: result.geometry.location.lng
  };
}

export { geoCode, geoCodeWithGoogleApi };
