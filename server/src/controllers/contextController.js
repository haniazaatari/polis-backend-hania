import * as contextService from '../services/context/contextService.js';
/**
 * Context Controller
 * Handles HTTP requests related to contexts
 */
import logger from '../utils/logger.js';
import { fail } from '../utils/responseHandlers.js';

/**
 * Handle GET request to retrieve all public contexts
 * @param {Object} _req - Express request object (unused)
 * @param {Object} res - Express response object
 */
async function handleGetContexts(_req, res) {
  try {
    const contexts = await contextService.getPublicContexts();
    res.status(200).json(contexts);
  } catch (err) {
    logger.error('Error getting contexts', err);
    fail(res, 500, 'polis_err_get_contexts_misc', err);
  }
}

/**
 * Handle POST request to create a new context
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handlePostContexts(req, res) {
  try {
    const uid = req.p.uid;
    const name = req.p.name;

    // Check if context with this name already exists
    const exists = await contextService.contextExists(name);
    if (exists) {
      return fail(res, 422, 'polis_err_post_context_exists');
    }

    // Create the context
    await contextService.createContext(name, uid);
    res.status(200).json({});
  } catch (err) {
    logger.error('Error creating context', err);
    fail(res, 500, 'polis_err_post_contexts_misc', err);
  }
}

export { handleGetContexts, handlePostContexts };
