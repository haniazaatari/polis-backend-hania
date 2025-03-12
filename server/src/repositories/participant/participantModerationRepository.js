import { queryP, queryP_readOnly } from '../../db/pg-query.js';
import logger from '../../utils/logger.js';

/**
 * Get social participants for moderation
 * @param {number} zid - Conversation ID
 * @param {number} limit - Maximum number of participants to return
 * @param {number|undefined} mod - Moderation status filter (optional)
 * @param {number} owner - User ID of the conversation owner
 * @returns {Promise<Array>} - Array of participants with social info
 */
async function getSocialParticipantsForMod(zid, limit, mod, owner) {
  try {
    let modClause = '';
    const params = [zid, limit, owner];

    if (mod !== undefined) {
      modClause = ' and mod = ($4)';
      params.push(mod);
    }

    const query = `
      with p as (
        select uid, pid, mod from participants where zid = ($1) ${modClause}
      ), 
      final_set as (
        select * from p limit ($2)
      ), 
      xids_subset as (
        select * from xids where owner = ($3) and x_profile_image_url is not null
      ), 
      all_rows as (
        select 
          final_set.mod, 
          xids_subset.x_profile_image_url as x_profile_image_url, 
          xids_subset.xid as xid, 
          xids_subset.x_name as x_name, 
          final_set.pid 
        from final_set 
        left join xids_subset on final_set.uid = xids_subset.uid
      ) 
      select * from all_rows where (xid is not null);
    `;

    return await queryP_readOnly(query, params);
  } catch (error) {
    logger.error('Error getting social participants for moderation', error);
    throw error;
  }
}

/**
 * Update participant moderation status
 * @param {number} zid - Conversation ID
 * @param {number} pid - Participant ID
 * @param {number} mod - New moderation status
 * @returns {Promise<void>}
 */
async function updateParticipantModerationStatus(zid, pid, mod) {
  try {
    const query = `
      UPDATE participants 
      SET mod = ($3) 
      WHERE zid = ($1) AND pid = ($2)
    `;

    await queryP(query, [zid, pid, mod]);
  } catch (error) {
    logger.error('Error updating participant moderation status', error);
    throw error;
  }
}

export { getSocialParticipantsForMod, updateParticipantModerationStatus };
