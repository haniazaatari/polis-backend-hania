import pg from 'pg';
import pgConnectionString from 'pg-connection-string';
import QueryStream from 'pg-query-stream';
import _ from 'underscore';
import Config from '../config.js';
import logger from '../utils/logger.js';
import { MPromise } from '../utils/metered.js';

const { Pool } = pg;
const { parse: parsePgConnectionString } = pgConnectionString;
const usingReplica = Config.databaseURL !== Config.readOnlyDatabaseURL;
const poolSize = Config.isDevMode ? 2 : usingReplica ? 3 : 12;
const pgConnection = Object.assign(parsePgConnectionString(Config.databaseURL), {
  max: poolSize,
  isReadOnly: false,
  ssl: Config.databaseSSL
    ? {
        rejectUnauthorized: false
      }
    : undefined,
  poolLog: (str, level) => {
    if (pgPoolLevelRanks.indexOf(level) <= pgPoolLoggingLevel) {
      logger.info(`pool.primary.${level} ${str}`);
    }
  }
});
const readsPgConnection = Object.assign(parsePgConnectionString(Config.readOnlyDatabaseURL), {
  max: poolSize,
  isReadOnly: true,
  ssl: Config.databaseSSL
    ? {
        rejectUnauthorized: false
      }
    : undefined,
  poolLog: (str, level) => {
    if (pgPoolLevelRanks.indexOf(level) <= pgPoolLoggingLevel) {
      logger.info(`pool.readonly.${level} ${str}`);
    }
  }
});
const readWritePool = new Pool(pgConnection);
const readPool = new Pool(readsPgConnection);
function queryImpl(pool, queryString, ...args) {
  let params;
  let callback;

  // Handle different argument patterns
  if (args.length === 0) {
    // No parameters, no callback
    params = [];
    callback = null;
  } else if (args.length === 1) {
    if (_.isFunction(args[0])) {
      // Only callback
      params = [];
      callback = args[0];
    } else {
      // Only parameters, no callback
      params = args[0];
      callback = null;
    }
  } else if (args.length === 2) {
    // Both parameters and callback
    params = args[0];
    callback = args[1];
    if (!_.isFunction(callback)) {
      throw 'unexpected db query syntax: second argument must be a callback';
    }
  } else {
    throw 'unexpected db query syntax: too many arguments';
  }

  return new Promise((resolve, reject) => {
    pool.connect((err, client, release) => {
      if (err) {
        if (callback) callback(err);
        release(err);
        logger.error('pg_connect_pool_fail', err);
        return reject(err);
      }

      // Enhanced debug logging to troubleshoot query issues
      logger.silly('Executing SQL query:', {
        query: queryString,
        params: JSON.stringify(params || []),
        paramTypes: Array.isArray(params) ? params.map((p) => typeof p) : [],
        paramValues: Array.isArray(params)
          ? params.map((p) => (p !== null && typeof p === 'object' ? JSON.stringify(p) : String(p)))
          : []
      });

      client.query(queryString, params, (err, results) => {
        if (err) {
          // Enhanced error logging for SQL errors
          logger.error('PostgreSQL query error:', {
            error: err.message,
            code: err.code,
            detail: err.detail,
            hint: err.hint,
            position: err.position,
            internalPosition: err.internalPosition,
            internalQuery: err.internalQuery,
            where: err.where,
            schema: err.schema,
            table: err.table,
            column: err.column,
            dataType: err.dataType,
            constraint: err.constraint,
            query: queryString,
            params: JSON.stringify(params || [])
          });
          release(err);
          if (callback) callback(err);
          return reject(err);
        }

        release();
        if (callback) callback(null, results);
        resolve(results.rows);
      });
    });
  });
}
const pgPoolLevelRanks = ['info', 'verbose'];
const pgPoolLoggingLevel = -1;
function query(queryString, ...args) {
  return queryImpl(readWritePool, queryString, ...args);
}
function query_readOnly(queryString, ...args) {
  return queryImpl(readPool, queryString, ...args);
}
function queryP_impl(pool, queryString, params) {
  if (!_.isString(queryString)) {
    return Promise.reject('query_was_not_string');
  }
  return new Promise((resolve, reject) => {
    queryImpl(pool, queryString, params, (err, result) => {
      if (err) {
        return reject(err);
      }
      if (!result || !result.rows) {
        return resolve([]);
      }
      resolve(result.rows);
    });
  });
}
function queryP(queryString, ...args) {
  return queryP_impl(readWritePool, queryString, ...args);
}
function queryP_readOnly(queryString, ...args) {
  return queryP_impl(readPool, queryString, ...args);
}
function queryP_readOnly_wRetryIfEmpty(queryString, ...args) {
  function retryIfEmpty(rows) {
    if (!rows.length) {
      return queryP(queryString, ...args);
    }
    return Promise.resolve(rows);
  }
  return queryP_impl(readPool, queryString, ...args).then(retryIfEmpty);
}
function queryP_metered_impl(isReadOnly, name, queryString, params) {
  const f = isReadOnly ? queryP_readOnly : queryP;
  if (_.isUndefined(name) || _.isUndefined(queryString) || _.isUndefined(params)) {
    throw new Error('polis_err_queryP_metered_impl missing params');
  }
  return MPromise(name, (resolve, reject) => {
    f(queryString, params).then(resolve, reject);
  });
}
function queryP_metered(name, queryString, params) {
  return queryP_metered_impl(false, name, queryString, params);
}
function queryP_metered_readOnly(name, queryString, params) {
  return queryP_metered_impl(true, name, queryString, params);
}
function stream_queryP_readOnly(queryString, params, onRow, onEnd, onError) {
  const query = new QueryStream(queryString, params);
  readPool.connect((err, client, done) => {
    if (err) {
      onError(err);
      return;
    }
    const stream = client.query(query);
    stream.on('data', (row) => {
      onRow(row);
    });
    stream.on('end', () => {
      done();
      onEnd();
    });
    stream.on('error', (error) => {
      done(error);
      onError(error);
    });
  });
}
export {
  query,
  query_readOnly,
  queryP,
  queryP_metered,
  queryP_metered_readOnly,
  queryP_readOnly,
  queryP_readOnly_wRetryIfEmpty,
  stream_queryP_readOnly,
  queryP as pgQueryP,
  queryP_readOnly as pgQueryP_readOnly,
  queryP_readOnly_wRetryIfEmpty as pgQueryP_readOnly_wRetryIfEmpty,
  stream_queryP_readOnly as stream_pgQueryP_readOnly
};
