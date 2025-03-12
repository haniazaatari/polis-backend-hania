import Config from '../../config.js';
import { hasAuthToken } from '../../services/auth/authService.js';
import { getConversationPreloadInfo } from '../../services/conversation/conversationService.js';
import logger from '../../utils/logger.js';
import { fetch404Page, fetchFileWithPreload } from '../services/fileService.js';
import { browserSupportsPushState, isUnsupportedBrowser } from '../utils/browserUtils.js';
import { extractConversationId, redirectTo } from '../utils/routeUtils.js';

const serverUrl = Config.getServerNameWithProtocol();

/**
 * Fetches the index file for a conversation with preloaded data
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise} - Express response
 */
export async function fetchIndexForConversation(req, res) {
  // Check for unsupported browsers
  if (isUnsupportedBrowser(req)) {
    return fetchFileWithPreload('/unsupportedBrowser.html', {}, res);
  }

  // Extract the conversation ID and fetch preload data
  const conversationId = extractConversationId(req.path);
  if (!conversationId) {
    return fetch404Page(res);
  }

  try {
    const preloadData = await getConversationPreloadInfo(conversationId);
    return fetchFileWithPreload('/index.html', preloadData, res);
  } catch (error) {
    logger.error(`Error fetching conversation data: ${error.message}`);
    return fetch404Page(res);
  }
}

/**
 * Conditionally fetches the index file or redirects based on auth state
 * Used for the root route (/)
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise} - Express response
 */
export function conditionalIndexFetcher(req, res) {
  if (hasAuthToken(req) || !browserSupportsPushState(req)) {
    return fetchFileWithPreload('/index_admin.html', {}, res);
  }
  return redirectTo(`${serverUrl}/home`, res);
}

/**
 * Generic index file fetcher with browser compatibility checks
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Object} preloadData - Data to inject into the HTML
 * @returns {Promise} - Express response
 */
export async function fetchIndex(req, res, preloadData = {}) {
  const indexPath = '/index.html';

  if (isUnsupportedBrowser(req)) {
    return fetchFileWithPreload('/unsupportedBrowser.html', {}, res);
  }

  if (!browserSupportsPushState(req) && req.path.length > 1 && !/^\/api/.exec(req.path)) {
    res.writeHead(302, { Location: `https://${req.headers.host}/#${req.path}` });
    return res.end();
  }

  return fetchFileWithPreload(indexPath, preloadData, res);
}

/**
 * Fetches the index without any preloaded data
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise} - Express response
 */
export function fetchIndexWithoutPreloadData(req, res) {
  return fetchIndex(req, res);
}

/**
 * Serves the first part of the third-party cookie test
 *
 * @param {Object} _req - Express request object (unused)
 * @param {Object} res - Express response object
 */
export function fetchThirdPartyCookieTestPt1(_req, res) {
  res.set({ 'Content-Type': 'text/html' });
  res.send(
    '<body>\n<script>\ndocument.cookie="thirdparty=yes; Max-Age=3600; SameSite=None; Secure";\ndocument.location="thirdPartyCookieTestPt2.html";\n</script>\n</body>'
  );
}

/**
 * Serves the second part of the third-party cookie test
 *
 * @param {Object} _req - Express request object (unused)
 * @param {Object} res - Express response object
 */
export function fetchThirdPartyCookieTestPt2(_req, res) {
  res.set({ 'Content-Type': 'text/html' });
  res.send(
    '<body>\n<script>\nif (window.parent) {\nif (/thirdparty=yes/.test(document.cookie)) {\nwindow.parent.postMessage("MM:3PCsupported", "*");\n} else {\nwindow.parent.postMessage("MM:3PCunsupported", "*");\n}\ndocument.cookie = "thirdparty=; expires=Thu, 01 Jan 1970 00:00:01 GMT;";\n}\n</script>\n</body>'
  );
}
