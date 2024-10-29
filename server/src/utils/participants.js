import { getPca } from './pca';
import { queryP_readOnly as pgQueryP_readOnly } from '../db/pg-query';
import Config from '../config';

export function getBidIndexToPidMapping(zid, math_tick) {
  math_tick = math_tick || -1;
  return pgQueryP_readOnly('select * from math_bidtopid where zid = ($1) and math_env = ($2);', [
    zid,
    Config.mathEnv
  ]).then((rows) => {
    if (!rows || !rows.length) {
      return new Error('polis_err_get_pca_results_missing');
    } else if (rows[0].data.math_tick <= math_tick) {
      return new Error('polis_err_get_pca_results_not_new');
    } else {
      return rows[0].data;
    }
  });
}

export function getPidsForGid(zid, gid, math_tick) {
  return Promise.all([getPca(zid, math_tick), getBidIndexToPidMapping(zid, math_tick)]).then(function (o) {
    if (!o[0] || !o[0].asPOJO) {
      return [];
    }
    o[0] = o[0].asPOJO;
    let clusters = o[0]['group-clusters'];
    let indexToBid = o[0]['base-clusters'].id;
    let bidToIndex = [];
    for (let i = 0; i < indexToBid.length; i++) {
      bidToIndex[indexToBid[i]] = i;
    }
    let indexToPids = o[1].bidToPid;
    let cluster = clusters[gid];
    if (!cluster) {
      return [];
    }
    let members = cluster.members;
    let pids = [];
    for (let i = 0; i < members.length; i++) {
      let bid = members[i];
      let index = bidToIndex[bid];
      let morePids = indexToPids ? indexToPids[index] : null;
      if (morePids) Array.prototype.push.apply(pids, morePids);
    }
    pids = pids.map(function (x) {
      return parseInt(x);
    });
    pids.sort(function (a, b) {
      return a - b;
    });
    return pids;
  });
}
