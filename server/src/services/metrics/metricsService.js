import { queryP } from '../../db/pg-query.js';
import logger from '../../utils/logger.js';

/**
 * Hash a string to a 32-bit integer
 * @param {string} s - String to hash
 * @returns {number} - Hashed integer
 */
function hashStringToInt32(s) {
  let h = 1;
  if (typeof s !== 'string' || !s.length) {
    return 99;
  }
  for (let i = 0; i < s.length; i++) {
    h = h * s.charCodeAt(i) * 31;
  }
  if (h < 0) {
    h = -h;
  }
  while (h > 2147483648) {
    h = h / 2;
  }
  return h;
}

/**
 * Record metrics data
 * @param {number|null} uid - User ID (optional)
 * @param {number[]} types - Metric types
 * @param {number[]} durs - Durations
 * @param {number} clientTimestamp - Client timestamp
 * @param {string} permanentCookie - Permanent cookie for anonymous tracking
 * @returns {Promise<void>} - Resolves when metrics are recorded
 */
function recordMetrics(uid, types, durs, clientTimestamp, permanentCookie) {
  const hashedPc = permanentCookie ? hashStringToInt32(permanentCookie) : null;

  const processedDurs = durs.map((dur) => {
    return dur === -1 ? null : dur;
  });

  const ages = types.map((_t, i) => clientTimestamp - (i < types.length ? clientTimestamp : 0));
  const now = Date.now();
  const timesInTermsOfServerTime = ages.map((a) => now - a);

  const entries = [];
  for (let i = 0; i < timesInTermsOfServerTime.length; i++) {
    entries.push(`(${[uid || 'null', types[i], processedDurs[i], hashedPc, timesInTermsOfServerTime[i]].join(',')})`);
  }

  if (entries.length === 0) {
    return Promise.resolve();
  }

  return queryP(`insert into metrics (uid, type, dur, hashedPc, created) values ${entries.join(',')};`, []).catch(
    (err) => {
      logger.error('Error recording metrics', err);
      throw err;
    }
  );
}

export { recordMetrics, hashStringToInt32 };
