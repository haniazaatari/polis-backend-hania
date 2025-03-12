import Config from '../config.js';
import logger from '../utils/logger.js';

/**
 * Sets default HTTP headers for JSON responses
 */
export function writeDefaultHead(_req, res, next) {
  res.set({
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  next();
}

/**
 * Redirects HTTP requests to HTTPS in production environments
 */
export function redirectIfNotHttps(req, res, next) {
  const devMode = Config.isDevMode;

  if (devMode || req.path === '/api/v3/testConnection') {
    return next();
  }

  const isHttps = req.headers['x-forwarded-proto'] === 'https';
  if (!isHttps) {
    logger.debug('redirecting to https', { headers: req.headers });
    if (req.method === 'GET') {
      res.writeHead(302, {
        Location: `https://${req.headers.host}${req.url}`
      });
      return res.end();
    }

    res.status(400).send('Please use HTTPS when submitting data.');
  }
  return next();
}
