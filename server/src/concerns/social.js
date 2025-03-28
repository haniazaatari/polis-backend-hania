import { LRUCache } from 'lru-cache';
import _ from 'underscore';
import { getConversationInfo } from '../conversation.js';
import { queryP, queryP_metered_readOnly, queryP_readOnly } from '../db/pg-query.js';
import { getBidsForPids } from '../routes/math.js';
import { isModerator, isPolisDev, polisTypes } from '../utils/common.js';
import { fail } from '../utils/fail.js';
import logger from '../utils/logger.js';
import { getPca } from '../utils/pca.js';

const votesForZidPidCache = new LRUCache({
  max: 5000
});

function removeNullOrUndefinedProperties(o) {
  for (const k in o) {
    const v = o[k];
    if (v === null || v === undefined) {
      delete o[k];
    }
  }
  return o;
}

function cacheVotesForZidPidWithTimestamp(zid, pid, math_tick, votes) {
  const key = `${zid}_${pid}`;
  const val = `${math_tick}:${votes}`;
  votesForZidPidCache.set(key, val);
}

function createEmptyVoteVector(greatestTid) {
  const a = [];
  for (let i = 0; i <= greatestTid; i++) {
    a[i] = 'u';
  }
  return a;
}

function getVotesForZidPidWithTimestampCheck(zid, pid, math_tick) {
  const key = `${zid}_${pid}`;
  const cachedVotes = votesForZidPidCache.get(key);
  if (cachedVotes) {
    const pair = cachedVotes.split(':');
    const cachedTime = Number(pair[0]);
    const votes = pair[1];
    if (cachedTime >= math_tick) {
      return votes;
    }
  }
  return null;
}

function getVotesForPids(zid, pids) {
  if (pids.length === 0) {
    return Promise.resolve([]);
  }
  return queryP_readOnly(
    `select * from votes where zid = ($1) and pid in (${pids.join(',')}) order by pid, tid, created;`,
    [zid]
  ).then((votesRows) => {
    for (let i = 0; i < votesRows.length; i++) {
      votesRows[i].weight = votesRows[i].weight / 32767;
    }
    return votesRows;
  });
}

function aggregateVotesToPidVotesObj(votes) {
  let i = 0;
  let greatestTid = 0;
  for (i = 0; i < votes.length; i++) {
    if (votes[i].tid > greatestTid) {
      greatestTid = votes[i].tid;
    }
  }
  const vectors = {};
  for (i = 0; i < votes.length; i++) {
    const v = votes[i];
    vectors[v.pid] = vectors[v.pid] || createEmptyVoteVector(greatestTid);
    const vote = v.vote;
    if (polisTypes.reactions.push === vote) {
      vectors[v.pid][v.tid] = 'd';
    } else if (polisTypes.reactions.pull === vote) {
      vectors[v.pid][v.tid] = 'a';
    } else if (polisTypes.reactions.pass === vote) {
      vectors[v.pid][v.tid] = 'p';
    } else {
      logger.error('unknown vote value');
    }
  }
  const vectors2 = {};
  _.each(vectors, (val, key) => {
    vectors2[key] = val.join('');
  });
  return vectors2;
}

function getVotesForZidPidsWithTimestampCheck(zid, pids, math_tick) {
  let cachedVotes = pids.map((pid) => ({
    pid: pid,
    votes: getVotesForZidPidWithTimestampCheck(zid, pid, math_tick)
  }));
  const uncachedPids = cachedVotes.filter((o) => !o.votes).map((o) => o.pid);
  cachedVotes = cachedVotes.filter((o) => !!o.votes);
  function toObj(items) {
    const o = {};
    for (let i = 0; i < items.length; i++) {
      o[items[i].pid] = items[i].votes;
    }
    return o;
  }
  if (uncachedPids.length === 0) {
    return Promise.resolve(toObj(cachedVotes));
  }
  return getVotesForPids(zid, uncachedPids).then((votesRows) => {
    const newPidToVotes = aggregateVotesToPidVotesObj(votesRows);
    _.each(newPidToVotes, (votes, pid) => {
      cacheVotesForZidPidWithTimestamp(zid, pid, math_tick, votes);
    });
    const cachedPidToVotes = toObj(cachedVotes);
    return Object.assign(newPidToVotes, cachedPidToVotes);
  });
}

function pullXInfoIntoSubObjects(ptptoiRecord) {
  const p = ptptoiRecord;
  if (p.x_profile_image_url || p.xid || p.x_email) {
    p.xInfo = {};
    p.xInfo.x_profile_image_url = p.x_profile_image_url;
    p.xInfo.xid = p.xid;
    p.xInfo.x_name = p.x_name;
    p.x_profile_image_url = undefined;
    p.xid = undefined;
    p.x_name = undefined;
    p.x_email = undefined;
  }
  return p;
}

function handle_GET_votes_famous(req, res) {
  doFamousQuery(req.p, req)
    .then(
      (data) => {
        res.status(200).json(data);
      },
      (err) => {
        fail(res, 500, 'polis_err_famous_proj_get2', err);
      }
    )
    .catch((err) => {
      fail(res, 500, 'polis_err_famous_proj_get1', err);
    });
}

function doFamousQuery(o, _req) {
  const uid = o?.uid;
  const zid = o?.zid;
  const math_tick = o?.math_tick;
  const hardLimit = _.isUndefined(o?.ptptoiLimit) ? 30 : o?.ptptoiLimit;
  const mod = 0;
  function getAuthorUidsOfFeaturedComments() {
    return getPca(zid, 0).then((pcaResult) => {
      if (!pcaResult || typeof pcaResult !== 'object' || pcaResult === null || !('asPOJO' in pcaResult)) {
        return [];
      }
      const pcaData = pcaResult.asPOJO;
      pcaData.consensus = pcaData.consensus || {};
      pcaData.consensus.agree = pcaData.consensus.agree || [];
      pcaData.consensus.disagree = pcaData.consensus.disagree || [];
      const consensusTids = _.union(
        _.pluck(pcaData.consensus.agree, 'tid'),
        _.pluck(pcaData.consensus.disagree, 'tid')
      );
      let groupTids = [];
      for (const gid in pcaData.repness) {
        const commentData = pcaData.repness[gid];
        groupTids = _.union(groupTids, _.pluck(commentData, 'tid'));
      }
      let featuredTids = _.union(consensusTids, groupTids);
      featuredTids.sort();
      featuredTids = _.uniq(featuredTids);
      if (featuredTids.length === 0) {
        return [];
      }
      const q = `with authors as (select distinct(uid) from comments where zid = ($1) and tid in (${featuredTids.join(',')}) order by uid) select authors.uid from authors inner join xids on xids.uid = authors.uid order by uid;`;
      return queryP_readOnly(q, [zid]).then((comments) => {
        let uids = _.pluck(comments, 'uid');
        uids = _.uniq(uids);
        return uids;
      });
    });
  }
  return Promise.all([getConversationInfo(zid), getAuthorUidsOfFeaturedComments()]).then((a) => {
    const conv = a[0];
    const authorUids = a[1];
    if (conv.is_anon) {
      return {};
    }
    return Promise.all([getSocialParticipants(zid, uid, hardLimit, mod, math_tick, authorUids)]).then((stuff) => {
      let participantsWithSocialInfo = stuff[0] || [];
      participantsWithSocialInfo = participantsWithSocialInfo.map((p) => {
        const x = pullXInfoIntoSubObjects(p);
        if (p.priority === 1000) {
          x.isSelf = true;
        }
        return x;
      });
      let pids = participantsWithSocialInfo.map((p) => p.pid);
      const pidToData = _.indexBy(participantsWithSocialInfo, 'pid');
      pids.sort((a, b) => a - b);
      pids = _.uniq(pids, true);
      return getVotesForZidPidsWithTimestampCheck(zid, pids, math_tick).then((vectors) =>
        getBidsForPids(zid, -1, pids).then(
          (pidsToBids) => {
            _.each(vectors, (value, pid, _list) => {
              pid = Number.parseInt(pid);
              const bid = pidsToBids[pid];
              const notInBucket = _.isUndefined(bid);
              const isSelf = pidToData[pid].isSelf;
              if (notInBucket && !isSelf) {
                delete pidToData[pid];
              } else if (pidToData[pid]) {
                pidToData[pid].votes = value;
                pidToData[pid].bid = bid;
              }
            });
            return pidToData;
          },
          (_err) => ({})
        )
      );
    });
  });
}

function getSocialParticipantsForMod_timed(zid, limit, mod, convOwner) {
  const _start = Date.now();
  return getSocialParticipantsForMod.apply(null, [zid, limit, mod, convOwner]).then((results) => results);
}

function getSocialParticipantsForMod(zid, limit, mod, owner) {
  let modClause = '';
  const params = [zid, limit, owner];
  if (!_.isUndefined(mod)) {
    modClause = ' and mod = ($4)';
    params.push(mod);
  }
  const q = `with p as (select uid, pid, mod from participants where zid = ($1) ${modClause}), final_set as (select * from p limit ($2)), xids_subset as (select * from xids where owner = ($3) and x_profile_image_url is not null), all_rows as (select final_set.mod, xids_subset.x_profile_image_url as x_profile_image_url, xids_subset.xid as xid, xids_subset.x_name as x_name, final_set.pid from final_set left join xids_subset on final_set.uid = xids_subset.uid ) select * from all_rows where (xid is not null) ;`;
  return queryP(q, params);
}

const socialParticipantsCache = new LRUCache({
  max: 999
});

function getSocialParticipants(zid, uid, limit, mod, math_tick, authorUids) {
  const cacheKey = [zid, limit, mod, math_tick].join('_');
  if (socialParticipantsCache.get(cacheKey)) {
    return socialParticipantsCache.get(cacheKey);
  }
  const authorsQueryParts = (authorUids || []).map(
    (authorUid) => `select ${Number(authorUid)} as uid, 900 as priority`
  );
  let authorsQuery = `(${authorsQueryParts.join(' union ')})`;
  if (!authorUids || authorUids.length === 0) {
    authorsQuery = null;
  }
  const q = `with p as (select uid, pid, mod from participants where zid = ($1) and vote_count >= 1), xids_subset as (select * from xids where owner in (select org_id from conversations where zid = ($1)) and x_profile_image_url is not null), xid_ptpts as (select p.uid, 100 as priority from p inner join xids_subset on xids_subset.uid = p.uid where p.mod >= ($4)), self as (select CAST($2 as INTEGER) as uid, 1000 as priority), ${authorsQuery ? `authors as ${authorsQuery}, ` : ''}pptpts as (select prioritized_ptpts.uid, max(prioritized_ptpts.priority) as priority from ( select * from self ${authorsQuery ? 'union ' + 'select * from authors ' : ''}union select * from xid_ptpts ) as prioritized_ptpts inner join p on prioritized_ptpts.uid = p.uid group by prioritized_ptpts.uid order by priority desc, prioritized_ptpts.uid asc), mod_pptpts as (select asdfasdjfioasjdfoi.uid, max(asdfasdjfioasjdfoi.priority) as priority from ( select * from pptpts union all select uid, 999 as priority from p where mod >= 2) as asdfasdjfioasjdfoi group by asdfasdjfioasjdfoi.uid order by priority desc, asdfasdjfioasjdfoi.uid asc), final_set as (select * from mod_pptpts limit ($3) ) select final_set.priority, xids_subset.x_profile_image_url as x_profile_image_url, xids_subset.xid as xid, xids_subset.x_name as x_name, xids_subset.x_email as x_email, p.pid from final_set left join xids_subset on final_set.uid = xids_subset.uid left join p on final_set.uid = p.uid ;`;
  return queryP_metered_readOnly('getSocialParticipants', q, [zid, uid, limit, mod]).then((response) => {
    socialParticipantsCache.set(cacheKey, response);
    return response;
  });
}

function handle_PUT_ptptois(req, res) {
  const zid = req.p.zid;
  const uid = req.p.uid;
  const pid = req.p.pid;
  const mod = req.p.mod;
  isModerator(zid, uid)
    .then((isMod) => {
      if (!isMod) {
        fail(res, 403, 'polis_err_ptptoi_permissions_123');
        return;
      }
      return queryP('update participants set mod = ($3) where zid = ($1) and pid = ($2);', [zid, pid, mod]).then(() => {
        res.status(200).json({});
      });
    })
    .catch((err) => {
      fail(res, 500, 'polis_err_ptptoi_misc_234', err);
    });
}

function handle_GET_ptptois(req, res) {
  const zid = req.p.zid;
  const mod = req.p.mod;
  const uid = req.p.uid;
  const limit = 99999;
  const convPromise = getConversationInfo(req.p.zid);
  const socialPtptsPromise = convPromise.then((conv) => {
    return getSocialParticipantsForMod_timed(zid, limit, mod, conv.owner);
  });
  Promise.all([socialPtptsPromise, getConversationInfo(zid)])
    .then((a) => {
      let ptptois = a[0];
      const conv = a[1];
      const isOwner = uid === conv.owner;
      const isAllowed = isOwner || isPolisDev(req.p.uid) || conv.is_data_open;
      if (isAllowed) {
        ptptois = ptptois.map(pullXInfoIntoSubObjects);
        ptptois = ptptois.map(removeNullOrUndefinedProperties);
        ptptois = ptptois.map((p) => {
          p.conversation_id = req.p.conversation_id;
          return p;
        });
      } else {
        ptptois = [];
      }
      res.status(200).json(ptptois);
    })
    .catch((err) => {
      fail(res, 500, 'polis_err_ptptoi_misc', err);
    });
}

export { doFamousQuery, handle_GET_ptptois, handle_GET_votes_famous, handle_PUT_ptptois };
