import logger from './logger.js';

function fail(res, httpCode, clientVisibleErrorString, err) {
  logger.error(clientVisibleErrorString, err);
  res.writeHead(httpCode || 500);
  res.end(clientVisibleErrorString);
}

export { fail };
