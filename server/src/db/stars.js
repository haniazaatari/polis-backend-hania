import pg from 'pg';
import _ from 'underscore';

async function addStar(zid, tid, pid, starred, created) {
  const starredValue = starred ? 1 : 0;
  let query = 'INSERT INTO stars (pid, zid, tid, starred, created) VALUES ($1, $2, $3, $4, default) RETURNING created;';
  const params = [pid, zid, tid, starredValue];
  if (!_.isUndefined(created)) {
    query = 'INSERT INTO stars (pid, zid, tid, starred, created) VALUES ($1, $2, $3, $4, $5) RETURNING created;';
    params.push(created);
  }
  return pg.queryP(query, params);
}

export { addStar };
