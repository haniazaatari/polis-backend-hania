import { queryP } from './pg-query.js';

/**
 * Record metrics data
 * @param {Array<{uid: number|null, type: number, dur: number|null, hashedPc: number|null, created: number}>} entries - Metrics entries
 * @returns {Promise<void>}
 */
async function recordMetricsData(entries) {
  if (entries.length === 0) {
    return;
  }

  const values = entries.map(({ uid, type, dur, hashedPc, created }) => {
    return `(${[uid || 'null', type, dur || 'null', hashedPc || 'null', created].join(',')})`;
  });

  await queryP(`insert into metrics (uid, type, dur, hashedPc, created) values ${values.join(',')};`, []);
}

export { recordMetricsData };
