import Config from '../config.js';
import logger from '../utils/logger.js';

// Whitelisted routes that can be accessed from any domain
const whitelistedCrossDomainRoutes = [/^\/api\/v[0-9]+\/launchPrep/, /^\/api\/v[0-9]+\/setFirstCookie/];

// Whitelisted domains that are allowed to make cross-domain requests
const whitelistedDomains = [
  Config.getServerHostname(),
  ...Config.whitelistItems,
  'localhost:5000',
  'localhost:5001',
  'localhost:5010',
  ''
];

/**
 * Check if a host matches any of the whitelisted domains
 * @param {string} host - The host to check
 * @returns {boolean} - True if the host matches a whitelisted domain
 */
function hasWhitelistMatches(host) {
  if (Config.isDevMode) {
    return true;
  }

  let hostWithoutProtocol = host;
  if (host.startsWith('http://')) {
    hostWithoutProtocol = host.slice(7);
  } else if (host.startsWith('https://')) {
    hostWithoutProtocol = host.slice(8);
  }

  for (let i = 0; i < whitelistedDomains.length; i++) {
    const w = whitelistedDomains[i];
    if (hostWithoutProtocol.endsWith(w || '')) {
      if (hostWithoutProtocol === w) {
        return true;
      }
      if (hostWithoutProtocol[hostWithoutProtocol.length - ((w || '').length + 1)] === '.') {
        return true;
      }
    }
  }
  return false;
}

/**
 * Middleware to handle OPTIONS requests
 * Returns a 204 No Content response for OPTIONS requests
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 * @returns {Object|void} - Express response object or void
 */
function checkIfOptions(req, res, next) {
  if (req.method.toLowerCase() !== 'options') {
    return next();
  }
  return res.send(204);
}

/**
 * Middleware to add CORS headers to the response
 * Includes domain whitelist checks for security
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 * @returns {Function} - Express next function
 */
function addCorsHeader(req, res, next) {
  const origin = req.get('Origin') || req.get('Referer') || '';
  const sanitizedOrigin = origin.replace(/#.*$/, '').match(/^[^\/]*\/\/[^\/]*/)?.[0] || '';
  const routeIsWhitelistedForAnyDomain = whitelistedCrossDomainRoutes.some((regex) => regex.test(req.path));

  // Check if the origin is whitelisted or if the route allows any domain
  if (!hasWhitelistMatches(sanitizedOrigin) && !routeIsWhitelistedForAnyDomain) {
    logger.info('not whitelisted', { headers: req.headers, path: req.path });
    return next(`unauthorized domain: ${sanitizedOrigin}`);
  }

  // Add CORS headers if there's a valid origin
  if (sanitizedOrigin) {
    res.header('Access-Control-Allow-Origin', sanitizedOrigin);
    res.header(
      'Access-Control-Allow-Headers',
      'Cache-Control, Pragma, Origin, Authorization, Content-Type, X-Requested-With'
    );
    res.header('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Credentials', 'true');
  }

  return next();
}

export { checkIfOptions, addCorsHeader, hasWhitelistMatches };
