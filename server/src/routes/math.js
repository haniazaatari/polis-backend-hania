import _ from 'underscore';
import Config from '../config.js';
import { queryP as pgQueryP, query_readOnly as pgQuery_readOnly } from '../db/pg-query.js';
import User from '../user.js';
import Utils from '../utils/common.js';
import fail from '../utils/fail.js';
import logger from '../utils/logger.js';
import { MPromise } from '../utils/metered.js';
import { getBidIndexToPidMapping } from '../utils/participants.js';
import { getPca } from '../utils/pca.js';
import { getZidForRid } from '../utils/zinvite.js';

function handle_GET_math_pca(_req, res) {
  res.status(304).end();
}
const pcaResultsExistForZid = {};
const getPidPromise = User.getPidPromise;
function handle_GET_math_pca2(req, res) {
  const zid = req.p.zid;
  let math_tick = req.p.math_tick;
  const ifNoneMatch = req.p.ifNoneMatch;
  if (ifNoneMatch) {
    if (math_tick !== undefined) {
      return fail(res, 400, 'Expected either math_tick param or If-Not-Match header, but not both.');
    }
    if (ifNoneMatch.includes('*')) {
      math_tick = 0;
    } else {
      const entries = ifNoneMatch.split(/ *, */).map((x) => {
        return Number(
          x
            .replace(/^[wW]\//, '')
            .replace(/^"/, '')
            .replace(/"$/, '')
        );
      });
      math_tick = Math.min(...entries);
    }
  } else if (math_tick === undefined) {
    math_tick = -1;
  }
  function finishWith304or404() {
    if (pcaResultsExistForZid[zid]) {
      res.status(304).end();
    } else {
      res.status(304).end();
    }
  }
  getPca(zid, math_tick)
    .then((data) => {
      if (data) {
        res.set({
          'Content-Type': 'application/json',
          'Content-Encoding': 'gzip',
          Etag: `"${data.asPOJO.math_tick}"`
        });
        res.send(data.asBufferOfGzippedJson);
      } else {
        if (pcaResultsExistForZid[zid] === undefined) {
          return getPca(zid, -1).then((data) => {
            const exists = !!data;
            pcaResultsExistForZid[zid] = exists;
            finishWith304or404();
          });
        }
        finishWith304or404();
      }
    })
    .catch((err) => {
      fail(res, 500, err);
    });
}
function handle_POST_math_update(req, res) {
  const zid = req.p.zid;
  const uid = req.p.uid;
  const math_env = Config.mathEnv;
  const math_update_type = req.p.math_update_type;
  Utils.isModerator(zid, uid).then((hasPermission) => {
    if (!hasPermission) {
      return fail(res, 500, 'handle_POST_math_update_permission');
    }
    return pgQueryP(
      "insert into worker_tasks (task_type, task_data, task_bucket, math_env) values ('update_math', $1, $2, $3);",
      [
        JSON.stringify({
          zid: zid,
          math_update_type: math_update_type
        }),
        zid,
        math_env
      ]
    )
      .then(() => {
        res.status(200).json({});
      })
      .catch((err) => {
        return fail(res, 500, 'polis_err_POST_math_update', err);
      });
  });
}
function handle_GET_math_correlationMatrix(req, res) {
  const rid = req.p.rid;
  const math_env = Config.mathEnv;
  const math_tick = req.p.math_tick;
  function finishAsPending() {
    res.status(202).json({
      status: 'pending'
    });
  }
  function hasCommentSelections() {
    return pgQueryP('select * from report_comment_selections where rid = ($1) and selection = 1;', [rid]).then(
      (rows) => {
        return rows.length > 0;
      }
    );
  }
  const requestExistsPromise = pgQueryP(
    "select * from worker_tasks where task_type = 'generate_report_data' and math_env=($2) " +
      'and task_bucket = ($1) ' +
      "and (task_data->>'math_tick')::int >= ($3) " +
      'and finished_time is NULL;',
    [rid, math_env, math_tick]
  );
  const resultExistsPromise = pgQueryP(
    'select * from math_report_correlationmatrix where rid = ($1) and math_env = ($2) and math_tick >= ($3);',
    [rid, math_env, math_tick]
  );
  Promise.all([resultExistsPromise, getZidForRid(rid)])
    .then((a) => {
      const rows = a[0];
      const zid = a[1];
      if (!rows || !rows.length) {
        return requestExistsPromise.then((requests_rows) => {
          const shouldAddTask = !requests_rows || !requests_rows.length;
          if (shouldAddTask) {
            return hasCommentSelections().then((hasSelections) => {
              if (!hasSelections) {
                return res.status(202).json({
                  status: 'polis_report_needs_comment_selection'
                });
              }
              return pgQueryP(
                "insert into worker_tasks (task_type, task_data, task_bucket, math_env) values ('generate_report_data', $1, $2, $3);",
                [
                  JSON.stringify({
                    rid: rid,
                    zid: zid,
                    math_tick: math_tick
                  }),
                  rid,
                  math_env
                ]
              ).then(finishAsPending);
            });
          }
          finishAsPending();
        });
      }
      res.json(rows[0].data);
    })
    .catch((err) => {
      return fail(res, 500, 'polis_err_GET_math_correlationMatrix', err);
    });
}
function handle_GET_bidToPid(req, res) {
  const zid = req.p.zid;
  const math_tick = req.p.math_tick;
  getBidIndexToPidMapping(zid, math_tick).then(
    (doc) => {
      const b2p = doc.bidToPid;
      res.json({
        bidToPid: b2p
      });
    },
    () => {
      res.status(304).end();
    }
  );
}
function getXids(zid) {
  return new MPromise('getXids', (resolve, reject) => {
    pgQuery_readOnly(
      'select pid, xid from xids inner join ' +
        '(select * from participants where zid = ($1)) as p on xids.uid = p.uid ' +
        ' where owner in (select org_id from conversations where zid = ($1));',
      [zid],
      (err, result) => {
        if (err) {
          reject('polis_err_fetching_xids');
          return;
        }
        resolve(result.rows);
      }
    );
  });
}
function handle_GET_xids(req, res) {
  const uid = req.p.uid;
  const zid = req.p.zid;
  Utils.isOwner(zid, uid).then(
    (owner) => {
      if (owner) {
        getXids(zid).then(
          (xids) => {
            res.status(200).json(xids);
          },
          (err) => {
            fail(res, 500, 'polis_err_get_xids', err);
          }
        );
      } else {
        fail(res, 403, 'polis_err_get_xids_not_authorized');
      }
    },
    (err) => {
      fail(res, 500, 'polis_err_get_xids', err);
    }
  );
}
function handle_POST_xidWhitelist(req, res) {
  const xid_whitelist = req.p.xid_whitelist;
  const len = xid_whitelist.length;
  const owner = req.p.uid;
  const entries = [];
  try {
    for (let i = 0; i < len; i++) {
      entries.push(`(${Utils.escapeLiteral(xid_whitelist[i])},${owner})`);
    }
  } catch (err) {
    return fail(res, 400, 'polis_err_bad_xid', err);
  }
  pgQueryP(`insert into xid_whitelist (xid, owner) values ${entries.join(',')} on conflict do nothing;`, [])
    .then((_result) => {
      res.status(200).json({});
    })
    .catch((err) => {
      return fail(res, 500, 'polis_err_POST_xidWhitelist', err);
    });
}
function getBidsForPids(zid, math_tick, pids) {
  const dataPromise = getBidIndexToPidMapping(zid, math_tick);
  const mathResultsPromise = getPca(zid, math_tick);
  return Promise.all([dataPromise, mathResultsPromise]).then((items) => {
    const b2p = items[0].bidToPid || [];
    const mathResults = items[1].asPOJO;
    function findBidForPid(pid) {
      let yourBidi = -1;
      for (let bidi = 0; bidi < b2p.length; bidi++) {
        const pids = b2p[bidi];
        if (pids.indexOf(pid) !== -1) {
          yourBidi = bidi;
          break;
        }
      }
      let yourBid = indexToBid[yourBidi];
      if (yourBidi >= 0 && _.isUndefined(yourBid)) {
        logger.error('polis_err_math_index_mapping_mismatch', { pid, b2p });
        yourBid = -1;
      }
      return yourBid;
    }
    const indexToBid = mathResults['base-clusters'].id;
    const bids = pids.map(findBidForPid);
    const pidToBid = _.object(pids, bids);
    return pidToBid;
  });
}
function handle_GET_bid(req, res) {
  const uid = req.p.uid;
  const zid = req.p.zid;
  const math_tick = req.p.math_tick;
  const dataPromise = getBidIndexToPidMapping(zid, math_tick);
  const pidPromise = getPidPromise(zid, uid);
  const mathResultsPromise = getPca(zid, math_tick);
  Promise.all([dataPromise, pidPromise, mathResultsPromise])
    .then(
      (items) => {
        const b2p = items[0].bidToPid || [];
        const pid = items[1];
        const mathResults = items[2].asPOJO;
        if (pid < 0) {
          fail(res, 500, 'polis_err_get_bid_bad_pid');
          return;
        }
        const indexToBid = mathResults['base-clusters'].id;
        let yourBidi = -1;
        for (let bidi = 0; bidi < b2p.length; bidi++) {
          const pids = b2p[bidi];
          if (pids.indexOf(pid) !== -1) {
            yourBidi = bidi;
            break;
          }
        }
        let yourBid = indexToBid[yourBidi];
        if (yourBidi >= 0 && _.isUndefined(yourBid)) {
          logger.error('polis_err_math_index_mapping_mismatch', { pid, b2p });
          yourBid = -1;
        }
        res.json({
          bid: yourBid
        });
      },
      () => {
        res.status(304).end();
      }
    )
    .catch((err) => {
      fail(res, 500, 'polis_err_get_bid_misc', err);
    });
}
export {
  handle_GET_math_pca,
  handle_GET_math_pca2,
  handle_POST_math_update,
  handle_GET_math_correlationMatrix,
  handle_GET_bidToPid,
  getXids,
  handle_GET_xids,
  handle_POST_xidWhitelist,
  getBidsForPids,
  handle_GET_bid
};
