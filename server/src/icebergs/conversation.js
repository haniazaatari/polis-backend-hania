import _ from 'underscore';
import { queryP as pgQueryP } from '../db/pg-query.js';

function updateConversationModifiedTime(zid, t) {
  const modified = _.isUndefined(t) ? Date.now() : Number(t);
  let query = 'update conversations set modified = ($2) where zid = ($1) and modified < ($2);';
  let params = [zid, modified];
  if (_.isUndefined(t)) {
    query = 'update conversations set modified = now_as_millis() where zid = ($1);';
    params = [zid];
  }
  return pgQueryP(query, params);
}

function updateLastInteractionTimeForConversation(zid, uid) {
  return pgQueryP(
    'update participants set last_interaction = now_as_millis(), nsli = 0 where zid = ($1) and uid = ($2);',
    [zid, uid]
  );
}

function updateVoteCount(zid, pid) {
  return pgQueryP(
    'update participants set vote_count = (select count(*) from votes where zid = ($1) and pid = ($2)) where zid = ($1) and pid = ($2)',
    [zid, pid]
  );
}

export default {
  updateConversationModifiedTime,
  updateLastInteractionTimeForConversation,
  updateVoteCount
};
