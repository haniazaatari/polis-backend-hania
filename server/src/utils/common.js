import akismetLib from 'akismet';
import pg from 'pg';
import _ from 'underscore';
import Config from '../config.js';
import { queryP as pgQueryP } from '../db/pg-query.js';
import logger from '../utils/logger.js';

const serverUrl = Config.getServerNameWithProtocol();

const akismet = akismetLib.client({
  blog: serverUrl,
  apiKey: Config.akismetAntispamApiKey
});

akismet.verifyKey((_err, verified) => {
  if (verified) {
    logger.silly('Akismet: API key successfully verified.');
  } else {
    logger.silly('Akismet: Unable to verify API key.');
  }
});

function strToHex(str) {
  let hex;
  let i;
  let result = '';
  for (i = 0; i < str.length; i++) {
    hex = str.charCodeAt(i).toString(16);
    result += `000${hex}`.slice(-4);
  }
  return result;
}

function hexToStr(hexString) {
  let j;
  const hexes = hexString.match(/.{1,4}/g) || [];
  let str = '';
  for (j = 0; j < hexes.length; j++) {
    str += String.fromCharCode(Number.parseInt(hexes[j], 16));
  }
  return str;
}

function doAddDataExportTask(math_env, email, zid, atDate, format, task_bucket) {
  return pgQueryP(
    "insert into worker_tasks (math_env, task_data, task_type, task_bucket) values ($1, $2, 'generate_export_data', $3);",
    [
      math_env,
      {
        email: email,
        zid: zid,
        'at-date': atDate,
        format: format
      },
      task_bucket
    ]
  );
}

const escapeLiteral = pg.Client.prototype.escapeLiteral;

function isDuplicateKey(err) {
  const isdup =
    err.code === 23505 ||
    err.code === '23505' ||
    err.sqlState === 23505 ||
    err.sqlState === '23505' ||
    err.messagePrimary?.includes('duplicate key value');
  return isdup;
}

/**
 * Return the first value if it's defined, otherwise return the second value
 * @param {*} first - First value to check
 * @param {*} second - Fallback value
 * @returns {*} - First value if defined, otherwise second value
 */
function ifDefinedFirstElseSecond(first, second) {
  return _.isUndefined(first) ? second : first;
}

/**
 * Removes properties with null or undefined values from an object
 * @param {Object} obj - The object to clean
 * @returns {Object} - The cleaned object
 */
function removeNullOrUndefinedProperties(obj) {
  // Iterate over each property in the object
  for (const key in obj) {
    // Get the value of the current property
    const value = obj[key];

    // If the value is null or undefined, delete the property
    if (value === null || value === undefined) {
      delete obj[key];
    }
  }

  // Return the cleaned object
  return obj;
}

export {
  strToHex,
  hexToStr,
  doAddDataExportTask,
  escapeLiteral,
  isDuplicateKey,
  ifDefinedFirstElseSecond,
  removeNullOrUndefinedProperties
};
