import LruCache from 'lru-cache';
import _ from 'underscore';
import logger from '../utils/logger.js';
import polisTypes from '../utils/polisTypes.js';
import { pgQueryP } from './pg-query.js';

// Cache for votes with a max size of 5000 entries
const votesForZidPidCache = new LruCache({
  max: 5000
});

/**
 * Create an empty vote vector with 'u' (unknown) values
 * @param {number} greatestTid - The highest comment ID
 * @returns {Array} - Array of 'u' values
 */
function createEmptyVoteVector(greatestTid) {
  const a = [];
  for (let i = 0; i <= greatestTid; i++) {
    a[i] = 'u';
  }
  return a;
}

/**
 * Aggregate votes into a pid-to-votes object
 * @param {Array} votes - Array of vote objects
 * @returns {Object} - Object mapping pid to vote string
 */
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

/**
 * Get votes for a specific zid and pid with timestamp check
 * @param {number} zid - Conversation ID
 * @param {number} pid - Participant ID
 * @param {number} math_tick - Math tick for cache invalidation
 * @returns {string|null} - Votes string or null if not cached
 */
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

/**
 * Cache votes for a specific zid and pid with timestamp
 * @param {number} zid - Conversation ID
 * @param {number} pid - Participant ID
 * @param {number} math_tick - Math tick for cache invalidation
 * @param {string} votes - Votes string
 */
function cacheVotesForZidPidWithTimestamp(zid, pid, math_tick, votes) {
  const key = `${zid}_${pid}`;
  const val = `${math_tick}:${votes}`;
  votesForZidPidCache.set(key, val);
}

/**
 * Get votes for a list of pids
 * @param {number} zid - Conversation ID
 * @param {Array} pids - Array of participant IDs
 * @returns {Promise<Array>} - Array of vote objects
 */
function getVotesForPids(zid, pids) {
  if (pids.length === 0) {
    return Promise.resolve([]);
  }
  return pgQueryP(`select * from votes where zid = ($1) and pid in (${pids.join(',')}) order by pid, tid, created;`, [
    zid
  ]).then((votesRows) => {
    for (let i = 0; i < votesRows.length; i++) {
      votesRows[i].weight = votesRows[i].weight / 32767;
    }
    return votesRows;
  });
}

/**
 * Get votes for a list of pids with timestamp check
 * @param {number} zid - Conversation ID
 * @param {Array} pids - Array of participant IDs
 * @param {number} math_tick - Math tick for cache invalidation
 * @returns {Promise<Object>} - Object mapping pid to votes
 */
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

export {
  getVotesForZidPidWithTimestampCheck,
  cacheVotesForZidPidWithTimestamp,
  getVotesForZidPidsWithTimestampCheck,
  getVotesForPids,
  aggregateVotesToPidVotesObj,
  createEmptyVoteVector
};
