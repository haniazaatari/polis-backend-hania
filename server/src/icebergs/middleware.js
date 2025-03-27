import responseTime from 'response-time';
/* eslint-disable sonarjs/cognitive-complexity */
import _ from 'underscore';
import Config from '../config.js';
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

export default {
  middleware_check_if_options,
  middleware_log_middleware_errors,
  middleware_log_request_body,
  middleware_responseTime_start
};
