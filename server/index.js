/**
 * Server entry point
 * This file is responsible for starting the server after the app is configured
 */
import app from './app.js';
import Config from './src/config.js';
import logger from './src/utils/logger.js';

/**
 * Start the server on the configured port or a provided port
 * @param {number} [port=Config.serverPort] - The port to listen on
 * @returns {Object} The server instance
 */
function startServer(port = Config.serverPort) {
  const server = app.listen(port);
  logger.info(`Server started on port ${port}`);
  return server;
}

// When this file is run directly (not imported), start the server
if (process.env.NODE_ENV !== 'test') {
  startServer();
}

export { startServer };
export default app;
