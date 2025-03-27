import { queryP as pgQueryP } from '../db/pg-query.js';

const addParticipant = async (zid, uid) => {
  await pgQueryP('INSERT INTO participants_extended (zid, uid) VALUES ($1, $2);', [zid, uid]);
  return pgQueryP('INSERT INTO participants (pid, zid, uid, created) VALUES (NULL, $1, $2, default) RETURNING *;', [
    zid,
    uid
  ]);
};

export default {
  addParticipant
};
