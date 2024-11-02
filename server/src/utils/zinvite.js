import LruCache from 'lru-cache';
import _ from 'underscore';
import pg from '../db/pg-query.js';
import logger from './logger.js';
import { MPromise } from './metered.js';
const zidToConversationIdCache = new LruCache({
  max: 1000
});

export function getZinvite(zid, dontUseCache) {
  const cachedConversationId = zidToConversationIdCache.get(zid);
  if (!dontUseCache && cachedConversationId) {
    return Promise.resolve(cachedConversationId);
  }
  return pg.queryP_metered('getZinvite', 'select * from zinvites where zid = ($1);', [zid]).then((rows) => {
    const conversation_id = rows?.[0]?.zinvite || void 0;
    if (conversation_id) {
      zidToConversationIdCache.set(zid, conversation_id);
    }
    return conversation_id;
  });
}

export function getZinvites(zids) {
  if (!zids.length) {
    return Promise.resolve(zids);
  }
  const numericZids = _.map(zids, (zid) => Number(zid));
  const uniqueZids = _.uniq(numericZids);
  const uncachedZids = uniqueZids.filter((zid) => !zidToConversationIdCache.get(zid));
  const zidsWithCachedConversationIds = uniqueZids
    .filter((zid) => !!zidToConversationIdCache.get(zid))
    .map((zid) => ({
      zid: zid,
      zinvite: zidToConversationIdCache.get(zid)
    }));
  function makeZidToConversationIdMap(arrays) {
    const zid2conversation_id = {};
    for (const a of arrays) {
      for (const o of a) {
        zid2conversation_id[o.zid] = o.zinvite;
      }
    }
    return zid2conversation_id;
  }
  return new MPromise('getZinvites', (resolve, reject) => {
    if (uncachedZids.length === 0) {
      resolve(makeZidToConversationIdMap([zidsWithCachedConversationIds]));
      return;
    }
    pg.query_readOnly(`select * from zinvites where zid in (${uncachedZids.join(',')});`, [], (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(makeZidToConversationIdMap([result.rows, zidsWithCachedConversationIds]));
      }
    });
  });
}

export function getZidForRid(rid) {
  return pg.queryP('select zid from reports where rid = ($1);', [rid]).then((row) => {
    if (!row || !row.length) {
      return null;
    }
    return row[0].zid;
  });
}

export async function getZidForUuid(uuid) {
  logger.debug(`getZidForUuid: ${uuid}`);
  try {
    const queryResult = await pg.queryP_readOnly('SELECT zid FROM zinvites WHERE uuid = $1', [uuid]);

    const rows = queryResult;

    logger.debug(`queryResult: ${JSON.stringify(queryResult)}`);
    logger.debug(`rows: ${JSON.stringify(rows)}`);

    // Return zid if found, null otherwise
    return rows.length > 0 ? rows[0].zid : null;
  } catch (err) {
    logger.error(`Error finding zid for uuid ${uuid}: ${err}`);
    return null;
  }
}
