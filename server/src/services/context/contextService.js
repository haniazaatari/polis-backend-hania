/**
 * Context Service
 * Handles business logic for contexts
 */
import * as contextRepository from '../../repositories/context/contextRepository.js';
import logger from '../../utils/logger.js';

/**
 * Get all public contexts
 * @returns {Promise<Array>} - Array of public contexts
 */
async function getPublicContexts() {
  try {
    return await contextRepository.getPublicContexts();
  } catch (error) {
    logger.error('Error getting public contexts', error);
    throw error;
  }
}

/**
 * Check if a context with the given name exists
 * @param {string} name - The context name to check
 * @returns {Promise<boolean>} - True if the context exists, false otherwise
 */
async function contextExists(name) {
  try {
    const context = await contextRepository.getContextByName(name);
    return !!context;
  } catch (error) {
    logger.error('Error checking if context exists', error);
    throw error;
  }
}

/**
 * Create a new context
 * @param {string} name - The name of the context
 * @param {number} uid - The user ID of the creator
 * @returns {Promise<void>}
 */
async function createContext(name, uid) {
  try {
    await contextRepository.createContext(name, uid);
  } catch (error) {
    logger.error('Error creating context', error);
    throw error;
  }
}

export { getPublicContexts, contextExists, createContext };
