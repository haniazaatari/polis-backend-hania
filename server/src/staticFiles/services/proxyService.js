import httpProxy from 'http-proxy';
import Config from '../../config.js';
import logger from '../../utils/logger.js';
import { fail } from '../../utils/responseHandlers.js';

// Create a reusable proxy server instance
const routingProxy = httpProxy.createProxyServer();

/**
 * Proxies requests to the static file server
 * Used as a catch-all for static assets
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export function proxy(req, res) {
  const hostname = Config.staticFilesHost;

  // Validate the hostname configuration
  if (!hostname) {
    const host = req?.headers?.host || '';
    const re = new RegExp(`${Config.getServerHostname()}$`);
    fail(res, 500, 'polis_err_proxy_serving_to_domain', new Error(host.match(re) ? host : ''));
    return;
  }

  // Add cache control headers in development mode
  if (Config.isDevMode) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', 0);
  }

  // Set the correct port and update host header
  const port = Config.staticFilesParticipationPort;
  if (req?.headers?.host) {
    req.headers.host = hostname;
  }

  // Configure the proxy target
  const proxyOptions = {
    target: {
      host: hostname,
      port: port
    }
  };

  // Forward the request
  routingProxy.web(req, res, proxyOptions);
}

// Set up generic error handler for the proxy
routingProxy.on('error', (err, _req, res) => {
  logger.error('Proxy error:', err);
  if (!res.headersSent) {
    fail(res, 500, 'polis_err_proxy_error', err);
  }
});
