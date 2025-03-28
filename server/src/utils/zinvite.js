import { LRUCache } from 'lru-cache';
import _ from 'underscore';
import { queryP, queryP_metered, queryP_readOnly, query_readOnly } from '../db/pg-query.js';
import logger from './logger.js';
import { MPromise } from './metered.js';
const zidToConversationIdCache = new LRUCache({
  max: 1000
});
export function getZinvite(zid, dontUseCache) {
  const cachedConversationId = zidToConversationIdCache.get(zid);
  if (!dontUseCache && cachedConversationId) {
    return Promise.resolve(cachedConversationId);
  }
  return queryP_metered('getZinvite', 'select * from zinvites where zid = ($1);', [zid]).then((rows) => {
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
  zids = _.map(zids, (zid) => Number(zid));
  zids = _.uniq(zids);
  const uncachedZids = zids.filter((zid) => !zidToConversationIdCache.get(zid));
  const zidsWithCachedConversationIds = zids
    .filter((zid) => !!zidToConversationIdCache.get(zid))
    .map((zid) => ({
      zid: zid,
      zinvite: zidToConversationIdCache.get(zid)
    }));
  function makeZidToConversationIdMap(arrays) {
    const zid2conversation_id = {};
    arrays.forEach((a) => {
      a.forEach((o) => {
        zid2conversation_id[o.zid] = o.zinvite;
      });
    });
    return zid2conversation_id;
  }
  return new MPromise('getZinvites', (resolve, reject) => {
    if (uncachedZids.length === 0) {
      resolve(makeZidToConversationIdMap([zidsWithCachedConversationIds]));
      return;
    }
    query_readOnly(`select * from zinvites where zid in (${uncachedZids.join(',')});`, [], (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(makeZidToConversationIdMap([result.rows, zidsWithCachedConversationIds]));
      }
    });
  });
}
export function getZidForRid(rid) {
  return queryP('select zid from reports where rid = ($1);', [rid]).then((row) => {
    if (!row || !row.length) {
      return null;
    }
    return row[0].zid;
  });
}
export async function getZidForUuid(uuid) {
  logger.debug(`getZidForUuid: ${uuid}`);
  try {
    const queryResult = await queryP_readOnly('SELECT zid FROM zinvites WHERE uuid = $1', [uuid]);
    const rows = queryResult;
    logger.debug(`queryResult: ${JSON.stringify(queryResult)}`);
    logger.debug(`rows: ${JSON.stringify(rows)}`);
    return rows.length > 0 ? rows[0].zid : null;
  } catch (err) {
    logger.error(`Error finding zid for uuid ${uuid}: ${err}`);
    return null;
  }
}
