import zlib from 'node:zlib';
import LruCache from 'lru-cache';
import _ from 'underscore';
import Config from '../config.js';
import { queryP_readOnly as pgQueryP_readOnly } from '../db/pg-query.js';
import logger from './logger.js';
import { addInRamMetric } from './metered.js';
const pcaCacheSize = Config.cacheMathResults ? 300 : 1;
const pcaCache = new LruCache({
  max: pcaCacheSize
});

let lastPrefetchedMathTick = -1;

export function fetchAndCacheLatestPcaData() {
  let lastPrefetchPollStartTime = Date.now();
  function waitTime() {
    const timePassed = Date.now() - lastPrefetchPollStartTime;
    return Math.max(0, 2500 - timePassed);
  }
  function pollForLatestPcaData() {
    lastPrefetchPollStartTime = Date.now();
    pgQueryP_readOnly('select * from math_main where caching_tick > ($1) order by caching_tick limit 10;', [
      lastPrefetchedMathTick
    ])
      .then((rows) => {
        if (!rows || !rows.length) {
          logger.info('mathpoll done');
          setTimeout(pollForLatestPcaData, waitTime());
          return;
        }
        const results = rows.map((row) => {
          const item = row.data;
          if (row.math_tick) {
            item.math_tick = Number(row.math_tick);
          }
          if (row.caching_tick) {
            item.caching_tick = Number(row.caching_tick);
          }
          logger.info('mathpoll updating', {
            caching_tick: item.caching_tick,
            zid: row.zid
          });
          if (item.caching_tick > lastPrefetchedMathTick) {
            lastPrefetchedMathTick = item.caching_tick;
          }
          processMathObject(item);
          return updatePcaCache(row.zid, item);
        });
        Promise.all(results).then(() => {
          setTimeout(pollForLatestPcaData, waitTime());
        });
      })
      .catch((err) => {
        logger.error('mathpoll error', err);
        setTimeout(pollForLatestPcaData, waitTime());
      });
  }
  pollForLatestPcaData();
}

export function getPca(zid, math_tick) {
  let cached = pcaCache.get(zid);
  if (cached && cached.expiration < Date.now()) {
    cached = undefined;
  }
  const cachedPOJO = cached?.asPOJO;
  if (cachedPOJO) {
    if (cachedPOJO.math_tick <= (math_tick || 0)) {
      logger.info('math was cached but not new', {
        zid,
        cached_math_tick: cachedPOJO.math_tick,
        query_math_tick: math_tick
      });
      return Promise.resolve(undefined);
    }

    logger.info('math from cache', { zid, math_tick });
    return Promise.resolve(cached);
  }

  logger.info('mathpoll cache miss', { zid, math_tick });
  const queryStart = Date.now();
  return pgQueryP_readOnly('select * from math_main where zid = ($1) and math_env = ($2);', [zid, Config.mathEnv]).then(
    (rows) => {
      const queryEnd = Date.now();
      const queryDuration = queryEnd - queryStart;
      addInRamMetric('pcaGetQuery', queryDuration);

      if (!rows || !rows.length) {
        logger.info('mathpoll related; after cache miss, unable to find data for', {
          zid,
          math_tick,
          math_env: Config.mathEnv
        });
        return undefined;
      }
      const item = rows[0].data;
      if (rows[0].math_tick) {
        item.math_tick = Number(rows[0].math_tick);
      }

      if (item.math_tick <= (math_tick || 0)) {
        logger.info('after cache miss, unable to find newer item', {
          zid,
          math_tick
        });
        return undefined;
      }
      logger.info('after cache miss, found item, adding to cache', {
        zid,
        math_tick
      });

      processMathObject(item);

      return updatePcaCache(zid, item);
    }
  );
}

function updatePcaCache(zid, item) {
  return new Promise((resolve, reject) => {
    item.zid = undefined;
    const asJSON = JSON.stringify(item);
    const buf = Buffer.from(asJSON, 'utf-8');
    zlib.gzip(buf, (err, jsondGzipdPcaBuffer) => {
      if (err) {
        return reject(err);
      }
      const o = {
        asPOJO: item,
        asJSON: asJSON,
        asBufferOfGzippedJson: jsondGzipdPcaBuffer,
        expiration: Date.now() + 3000,
        consensus: item.consensus || { agree: {}, disagree: {} },
        repness: item.repness || {}
      };
      pcaCache.set(zid, o);
      resolve(o);
    });
  });
}

function processMathObject(o) {
  function remapSubgroupStuff(o) {
    if (!o) {
      return o;
    }
    function safeMap(input, mapFn) {
      if (Array.isArray(input)) {
        return input.map(mapFn);
      }
      if (input && typeof input === 'object') {
        return Object.keys(input).map((key) => mapFn(input[key], Number(key)));
      }
      return [];
    }
    const subgroupProperties = [
      'group-clusters',
      'repness',
      'group-votes',
      'subgroup-repness',
      'subgroup-votes',
      'subgroup-clusters'
    ];

    for (const prop of subgroupProperties) {
      if (o[prop]) {
        o[prop] = safeMap(o[prop], (val, i) => ({
          id: Number(i),
          val: val
        }));
      }
    }
    return o;
  }

  if (_.isArray(o['group-clusters'])) {
    o['group-clusters'] = o['group-clusters'].map((g) => {
      return { id: Number(g.id), val: g };
    });
  }
  const propsToConvert = ['repness', 'group-votes', 'subgroup-repness', 'subgroup-votes', 'subgroup-clusters'];

  for (const prop of propsToConvert) {
    if (!_.isArray(o[prop])) {
      o[prop] = _.keys(o[prop]).map((gid) => ({
        id: Number(gid),
        val: o[prop][gid]
      }));
      if (prop.startsWith('subgroup-')) {
        o[prop].map(remapSubgroupStuff);
      }
    }
  }

  function toObj(a) {
    const obj = {};
    if (!a) {
      return obj;
    }
    for (let i = 0; i < a.length; i++) {
      obj[a[i].id] = a[i].val;
      obj[a[i].id].id = a[i].id;
    }
    return obj;
  }
  function toArray(a) {
    if (!a) {
      return [];
    }
    return a.map((g) => {
      const id = g.id;
      const gVal = g.val;
      gVal.id = id;
      return gVal;
    });
  }
  o.repness = toObj(o.repness);
  o['group-votes'] = toObj(o['group-votes']);
  o['group-clusters'] = toArray(o['group-clusters']);
  o['subgroup-repness'] = undefined;
  o['subgroup-votes'] = undefined;
  o['subgroup-clusters'] = undefined;
  return o;
}
