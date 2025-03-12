import { createSessionToken } from '../../repositories/auth/tokenRepository.js';
import { generateToken } from '../../utils/crypto.js';
import logger from '../../utils/logger.js';
import { addAuthCookies, clearAuthCookies } from './cookieService.js';
import * as tokenService from './tokenService.js';

/**
 * Start a new session and add cookies to the response
 * @param {number} uid - User ID
 * @param {Object} res - Express response object
 * @returns {Promise<string>} - Session token
 */
async function startSessionAndAddCookies(uid, res) {
  try {
    const token = await createSession(uid);
    addAuthCookies(res, token, uid);
    return token;
  } catch (error) {
    logger.error('Error starting session and adding cookies', error);
    throw error;
  }
}

/**
 * End a session and clear cookies
 * @param {string} token - Session token
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
async function endSessionAndClearCookies(token, res) {
  try {
    await endSession(token);
    clearAuthCookies(res);
  } catch (error) {
    logger.error('Error ending session and clearing cookies', error);
    throw error;
  }
}

/**
 * Generate a session token
 * @returns {string} - A new session token
 */
function generateSessionToken() {
  return generateToken(20);
}

/**
 * Create a new session
 * @param {number} uid - The user ID
 * @returns {Promise<string>} - The session token
 */
async function createSession(uid) {
  try {
    const token = generateSessionToken();
    await createSessionToken(uid, token);
    return token;
  } catch (error) {
    logger.error('Error creating session', error);
    throw error;
  }
}

/**
 * End a session
 * @param {string} token - The session token
 * @returns {Promise<void>}
 */
async function endSession(token) {
  try {
    await tokenService.deleteToken(token);
  } catch (error) {
    logger.error('Error ending session', error);
    throw error;
  }
}

export { createSession, endSession, endSessionAndClearCookies, generateSessionToken, startSessionAndAddCookies };
