import Config from '../config';
import { queryP_readOnly as pgQueryP_readOnly } from '../db/pg-query';
import { getPca } from './pca';

export function getBidIndexToPidMapping(zid, math_tick) {
  math_tick = math_tick || -1;
  return pgQueryP_readOnly('select * from math_bidtopid where zid = ($1) and math_env = ($2);', [
    zid,
    Config.mathEnv
  ]).then((rows) => {
    if (!rows || !rows.length) {
      return new Error('polis_err_get_pca_results_missing');
    }
    if (rows[0].data.math_tick <= math_tick) {
      return new Error('polis_err_get_pca_results_not_new');
    }
    return rows[0].data;
  });
}

export function getPidsForGid(zid, gid, math_tick) {
  return Promise.all([getPca(zid, math_tick), getBidIndexToPidMapping(zid, math_tick)]).then((o) => {
    if (!o[0] || !o[0].asPOJO) {
      return [];
    }
    o[0] = o[0].asPOJO;
    const clusters = o[0]['group-clusters'];
    const indexToBid = o[0]['base-clusters'].id;
    const bidToIndex = [];
    for (let i = 0; i < indexToBid.length; i++) {
      bidToIndex[indexToBid[i]] = i;
    }
    const indexToPids = o[1].bidToPid;
    const cluster = clusters[gid];
    if (!cluster) {
      return [];
    }
    const members = cluster.members;
    let pids = [];
    for (let i = 0; i < members.length; i++) {
      const bid = members[i];
      const index = bidToIndex[bid];
      const morePids = indexToPids ? indexToPids[index] : null;
      if (morePids) Array.prototype.push.apply(pids, morePids);
    }
    pids = pids.map((x) => Number.parseInt(x));
    pids.sort((a, b) => a - b);
    return pids;
  });
}
