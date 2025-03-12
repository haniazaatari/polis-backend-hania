import { encode } from 'html-entities';
import Config from '../../config.js';
import logger from '../../utils/logger.js';
import { fail } from '../../utils/responseHandlers.js';

/**
 * Creates a file fetcher function that can be used as a route handler
 * @param {string} path - The path to fetch
 * @param {Object} headers - HTTP headers to include in the response
 * @param {Object} preloadData - Data to inject into the response HTML
 * @param {number} [port] - The port to fetch from (defaults to participation port)
 * @returns {Function} - Route handler function
 */
export function makeFileFetcher(path, headers, preloadData = {}, port = Config.staticFilesParticipationPort) {
  return async (_req, res) => {
    const hostname = Config.staticFilesHost;

    if (!hostname) {
      fail(res, 500, 'polis_err_file_fetcher_serving_to_domain');
      return;
    }

    const url = `http://${hostname}:${port}${path}`;
    logger.info(`Fetching file from: ${url}`);

    try {
      // Fetch the file content
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
      }

      // Get the original content
      let content = await response.text();

      // Replace preload data placeholder if needed
      if (preloadData && Object.keys(preloadData).length > 0) {
        content = content.replace('"REPLACE_THIS_WITH_PRELOAD_DATA"', JSON.stringify(preloadData));
      }

      // Add Facebook meta tags if conversation data is present
      let fbMetaTagsString = '<meta property="og:image" content="https://s3.amazonaws.com/pol.is/polis_logo.png" />\n';
      if (preloadData?.conversation) {
        fbMetaTagsString += `    <meta property="og:title" content="${encode(preloadData.conversation.topic)}" />\n`;
        fbMetaTagsString += `    <meta property="og:description" content="${encode(preloadData.conversation.description)}" />\n`;
      }
      content = content.replace('<!-- REPLACE_THIS_WITH_FB_META_TAGS -->', fbMetaTagsString);

      // Set headers and send response
      res.set(headers);
      res.send(content);
    } catch (err) {
      logger.error(`Error fetching file: ${err.message}`);
      fail(res, 500, `polis_err_finding_file ${path}`, err);
    }
  };
}

/**
 * Fetches a file and injects preload data
 * @param {string} path - The path to fetch
 * @param {Object} preloadData - Data to inject into the HTML
 * @param {Object} res - Express response object
 * @param {number} [port] - The port to fetch from
 * @returns {Promise} - Express response
 */
export function fetchFileWithPreload(path, preloadData, res, port = Config.staticFilesParticipationPort) {
  const headers = { 'Content-Type': 'text/html' };
  const fetcher = makeFileFetcher(path, headers, preloadData, port);
  return fetcher(null, res);
}

/**
 * Fetches the 404 page
 * @param {Object} res - Express response object
 * @returns {Promise} - Express response
 */
export function fetch404Page(res) {
  return fetchFileWithPreload('/404.html', {}, res);
}

/**
 * Fetches the admin page
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise} - Express response
 */
export function fetchIndexForAdminPage(_req, res) {
  return fetchFileWithPreload('/index_admin.html', {}, res, Config.staticFilesAdminPort);
}

/**
 * Fetches the report page
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise} - Express response
 */
export function fetchIndexForReportPage(_req, res) {
  return fetchFileWithPreload('/index_report.html', {}, res);
}
