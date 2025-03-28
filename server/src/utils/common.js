import akismetLib from 'akismet';
import pg from 'pg';
import _ from 'underscore';
import Config from '../config.js';
import { getConversationInfo } from '../conversation.js';
import { queryP, queryP_readOnly, query_readOnly } from '../db/pg-query.js';
import logger from '../utils/logger.js';
import { MPromise } from '../utils/metered.js';

const serverUrl = Config.getServerUrl();
const polisDevs = Config.adminUIDs ? JSON.parse(Config.adminUIDs) : [];
const akismet = akismetLib.client({
  blog: serverUrl,
  apiKey: Config.akismetAntispamApiKey
});

akismet.verifyKey((_err, verified) => {
  if (verified) {
    logger.debug('Akismet: API key successfully verified.');
  } else {
    logger.debug('Akismet: Unable to verify API key.');
  }
});

const escapeLiteral = pg.Client.prototype.escapeLiteral;

const polisTypes = {
  reactions: {
    push: 1,
    pull: -1,
    see: 0,
    pass: 0
  },
  staractions: {
    unstar: 0,
    star: 1
  },
  mod: {
    ban: -1,
    unmoderated: 0,
    ok: 1
  }
};
polisTypes.reactionValues = _.values(polisTypes.reactions);
polisTypes.starValues = _.values(polisTypes.staractions);

function isSpam(o) {
  return new MPromise('isSpam', (resolve, reject) => {
    akismet.checkSpam(o, (err, spam) => {
      if (err) {
        reject(err);
      } else {
        resolve(spam);
      }
    });
  });
}

function isPolisDev(uid) {
  return polisDevs.indexOf(uid) >= 0;
}

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

function isConversationOwner(zid, uid, callback) {
  query_readOnly('SELECT * FROM conversations WHERE zid = ($1) AND owner = ($2);', [zid, uid], (err, docs) => {
    if (!docs || !docs.rows || docs.rows.length === 0) {
      err = err || 1;
    }
    callback?.(err);
  });
}

function isModerator(zid, uid) {
  if (isPolisDev(uid)) {
    return Promise.resolve(true);
  }
  return queryP_readOnly(
    'select count(*) from conversations where owner in (select uid from users where site_id = (select site_id from users where uid = ($2))) and zid = ($1);',
    [zid, uid]
  ).then((rows) => rows[0].count >= 1);
}

function doAddDataExportTask(math_env, email, zid, atDate, format, task_bucket) {
  return queryP(
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

function isOwner(zid, uid) {
  return getConversationInfo(zid).then((info) => info.owner === uid);
}

function isDuplicateKey(err) {
  const isdup =
    err.code === 23505 ||
    err.code === '23505' ||
    err.sqlState === 23505 ||
    err.sqlState === '23505' ||
    err.messagePrimary?.includes('duplicate key value');
  return isdup;
}

function ifDefinedFirstElseSecond(first, second) {
  return _.isUndefined(first) ? second : first;
}

function ifDefinedSet(name, source, dest) {
  if (!_.isUndefined(source[name])) {
    dest[name] = source[name];
  }
}

export {
  doAddDataExportTask,
  escapeLiteral,
  hexToStr,
  ifDefinedFirstElseSecond,
  ifDefinedSet,
  isConversationOwner,
  isDuplicateKey,
  isModerator,
  isOwner,
  isPolisDev,
  isSpam,
  polisTypes,
  strToHex
};
