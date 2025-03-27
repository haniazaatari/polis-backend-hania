import responseTime from 'response-time';
import _ from 'underscore';
import Config from '../config.js';
import { fail } from '../utils/fail.js';
import logger from '../utils/logger.js';
import { addInRamMetric } from '../utils/metrics.js';

const devMode = Config.devMode;

function middleware_log_request_body(req, _res, next) {
  if (devMode) {
    let b = '';
    if (req.body) {
      const temp = _.clone(req.body);
      if (temp.password) {
        temp.password = 'some_password';
      }
      if (temp.newPassword) {
        temp.newPassword = 'some_password';
      }
      if (temp.password2) {
        temp.password2 = 'some_password';
      }
      if (temp.hname) {
        temp.hname = 'somebody';
      }
      if (temp.polisApiKey) {
        temp.polisApiKey = 'pkey_somePolisApiKey';
      }
      b = JSON.stringify(temp);
    }
    if (req.path !== '/api/v3/math/pca2') {
      logger.debug('middleware_log_request_body', { path: req.path, body: b });
    }
  }
  next();
}

function middleware_log_middleware_errors(err, _req, _res, next) {
  if (!err) {
    return next();
  }
  logger.error('middleware_log_middleware_errors', err);
  next(err);
}

function middleware_check_if_options(req, res, next) {
  if (req.method.toLowerCase() !== 'options') {
    return next();
  }
  return res.send(204);
}

const middleware_responseTime_start = responseTime((req, _res, time) => {
  if (req?.route?.path) {
    const path = req.route.path;
    time = Math.trunc(time);
    addInRamMetric(path, time);
  }
});

function redirectIfNotHttps(req, res, next) {
  if (devMode || req.path === '/api/v3/testConnection' || Config.useNetworkHost) {
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

function writeDefaultHead(_req, res, next) {
  res.set({
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  next();
}

function haltOnTimeout(req, res, next) {
  if (req.timedout) {
    fail(res, 500, 'polis_err_timeout_misc');
  } else {
    next();
  }
}

function makeRedirectorTo(path) {
  return (req, res) => {
    const protocol = devMode ? 'http://' : 'https://';
    const url = protocol + req?.headers?.host + path;
    res.writeHead(302, {
      Location: url
    });
    res.end();
  };
}

function redirectIfHasZidButNoConversationId(req, res, next) {
  if (req.body.zid && !req.body.conversation_id) {
    logger.info('redirecting old zid user to about page');
    const path = '/about';
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    res.writeHead(302, {
      Location: `${protocol}://${req?.headers?.host}${path}`
    });
    return res.end();
  }
  return next();
}

export default {
  haltOnTimeout,
  makeRedirectorTo,
  middleware_check_if_options,
  middleware_log_middleware_errors,
  middleware_log_request_body,
  middleware_responseTime_start,
  redirectIfHasZidButNoConversationId,
  redirectIfNotHttps,
  writeDefaultHead
};
