import Config from '../../config.js';

/**
 * Extracts conversation ID from a URL path
 *
 * @param {string} path - URL path
 * @returns {string|null} - Extracted conversation ID or null if not found
 */
export function extractConversationId(path) {
  const match = path.match(/[0-9][0-9A-Za-z]+/);
  return match ? match[0] : null;
}

/**
 * Redirects to a specified path
 *
 * @param {string} path - The path to redirect to
 * @param {Object} res - Express response object
 * @param {number} statusCode - HTTP status code for the redirect (default: 302)
 * @returns {Object} - Express response object
 */
export function redirectTo(path, res, statusCode = 302) {
  res.writeHead(statusCode, { Location: path });
  return res.end();
}

/**
 * Creates a middleware function that redirects to a specified path
 *
 * @param {string} path - The path to redirect to
 * @returns {Function} - Express middleware function
 */
export function makeRedirectorTo(path) {
  return (req, res) => {
    const protocol = Config.isDevMode ? 'http://' : 'https://';
    const host = req?.headers?.host || '';
    const url = protocol + host + path;

    res.writeHead(302, {
      Location: url
    });
    res.end();
  };
}

/**
 * Normalizes URLs by removing trailing slashes and fixing query strings
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
export function normalizeUrl(req, res, next) {
  let pathAndQuery = req.originalUrl || '';

  // Remove trailing slash
  if (pathAndQuery.endsWith('/')) {
    pathAndQuery = pathAndQuery.slice(0, -1);
  }

  // Fix query string format
  if (pathAndQuery.indexOf('?') >= 1) {
    pathAndQuery = pathAndQuery.replace('/?', '?');
  }

  // Only redirect if the URL was changed
  if (pathAndQuery !== req.originalUrl) {
    const protocol = req.protocol || 'http';
    const host = req.get('host') || '';
    const fullUrl = `${protocol}://${host}${pathAndQuery}`;
    res.redirect(fullUrl);
  } else {
    next();
  }
}
