/**
 * Participants Database Module
 * Contains direct database operations for participants
 */
import LruCache from 'lru-cache';
import { queryP, queryP_metered_readOnly } from './pg-query.js';
import { sql_participants_extended } from './sql.js';

// Cache for social participants
const socialParticipantsCache = new LruCache({
  maxAge: 1000 * 30, // 30 seconds
  max: 999
});

/**
 * Add a participant to a conversation
 * @param {number} zid - The conversation ID
 * @param {number} uid - The user ID
 * @returns {Promise<Array>} - The inserted participant row
 */
async function addParticipant(zid, uid) {
  return queryP('INSERT INTO participants (zid, uid) VALUES ($1, $2) RETURNING *;', [zid, uid]);
}

/**
 * Add extended participant information
 * @param {number} zid - The conversation ID
 * @param {number} uid - The user ID
 * @param {Object} data - Extended participant data
 * @returns {Promise<void>}
 */
async function addExtendedParticipantInfo(zid, uid, data) {
  if (!data || !Object.keys(data).length) {
    return Promise.resolve();
  }

  const params = Object.assign({}, data, {
    zid: zid,
    uid: uid,
    modified: 9876543212345
  });

  const qUpdate = sql_participants_extended
    .update(params)
    .where(sql_participants_extended.zid.equals(zid))
    .and(sql_participants_extended.uid.equals(uid));

  let qString = qUpdate.toString();
  qString = qString.replace('9876543212345', 'now_as_millis()');

  return queryP(qString, []);
}

/**
 * Get social participants for a conversation
 * @param {number} zid - The conversation ID
 * @param {number} uid - The user ID
 * @param {number} limit - Maximum number of participants to return
 * @param {number} mod - Moderation status
 * @param {number} math_tick - Math tick for caching
 * @param {Array} authorUids - Array of author UIDs
 * @returns {Promise<Array>} - Array of participants with social info
 */
async function getSocialParticipants(zid, uid, limit, mod, math_tick, authorUids) {
  // Use cache key based on parameters
  const cacheKey = [zid, limit, mod, math_tick].join('_');

  // Check cache first
  if (socialParticipantsCache.get(cacheKey)) {
    return socialParticipantsCache.get(cacheKey);
  }

  // Build author query parts
  const authorsQueryParts = (authorUids || []).map(
    (authorUid) => `select ${Number(authorUid)} as uid, 900 as priority`
  );

  let authorsQuery = `(${authorsQueryParts.join(' union ')})`;
  if (!authorUids || authorUids.length === 0) {
    authorsQuery = null;
  }

  // Build the full query - matching the original implementation
  const q = `with p as (select uid, pid, mod from participants where zid = ($1) and vote_count >= 1), 
    xids_subset as (select * from xids where owner in (select org_id from conversations where zid = ($1)) and x_profile_image_url is not null), 
    xid_ptpts as (select p.uid, 100 as priority from p inner join xids_subset on xids_subset.uid = p.uid where p.mod >= ($4)), 
    self as (select CAST($2 as INTEGER) as uid, 1000 as priority), 
    ${authorsQuery ? `authors as ${authorsQuery}, ` : ''} 
    pptpts as (select prioritized_ptpts.uid, max(prioritized_ptpts.priority) as priority from ( 
      select * from self ${authorsQuery ? 'union ' + 'select * from authors ' : ''} 
      union select * from xid_ptpts 
    ) as prioritized_ptpts inner join p on prioritized_ptpts.uid = p.uid group by prioritized_ptpts.uid order by priority desc, prioritized_ptpts.uid asc), 
    mod_pptpts as (select asdfasdjfioasjdfoi.uid, max(asdfasdjfioasjdfoi.priority) as priority from ( 
      select * from pptpts union all select uid, 999 as priority from p where mod >= 2
    ) as asdfasdjfioasjdfoi group by asdfasdjfioasjdfoi.uid order by priority desc, asdfasdjfioasjdfoi.uid asc), 
    final_set as (select * from mod_pptpts limit ($3) ) 
    select final_set.priority, xids_subset.x_profile_image_url as x_profile_image_url, xids_subset.xid as xid, 
    xids_subset.x_name as x_name, xids_subset.x_email as x_email, p.pid 
    from final_set 
    left join xids_subset on final_set.uid = xids_subset.uid 
    left join p on final_set.uid = p.uid;`;

  // Execute the query and cache the result
  const response = await queryP_metered_readOnly('getSocialParticipants', q, [zid, uid, limit, mod]);
  socialParticipantsCache.set(cacheKey, response);
  return response;
}

export { addParticipant, addExtendedParticipantInfo, getSocialParticipants };
