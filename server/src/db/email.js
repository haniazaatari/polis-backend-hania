import { queryP, queryP_readOnly } from './pg-query.js';

/**
 * Subscribe a user to notifications for a conversation
 * @param {number} zid - The conversation ID
 * @param {number} uid - The user ID
 * @param {string} email - The user's email
 * @returns {Promise<number>} - The subscription type
 */
async function subscribeToNotifications(zid, uid, email) {
  const type = 1;
  await queryP('update participants_extended set subscribe_email = ($3) where zid = ($1) and uid = ($2);', [
    zid,
    uid,
    email
  ]);
  await queryP('update participants set subscribed = ($3) where zid = ($1) and uid = ($2);', [zid, uid, type]);
  return type;
}

/**
 * Unsubscribe a user from notifications for a conversation
 * @param {number} zid - The conversation ID
 * @param {number} uid - The user ID
 * @returns {Promise<number>} - The subscription type
 */
async function unsubscribeFromNotifications(zid, uid) {
  const type = 0;
  await queryP('update participants set subscribed = ($3) where zid = ($1) and uid = ($2);', [zid, uid, type]);
  return type;
}

/**
 * Add a notification task for a conversation
 * @param {number} zid - The conversation ID
 * @returns {Promise<void>}
 */
async function addNotificationTask(zid) {
  await queryP(
    'insert into notification_tasks (zid) values ($1) on conflict (zid) do update set modified = now_as_millis();',
    [zid]
  );
}

/**
 * Add a notification task for a conversation if it doesn't exist
 * @param {number} zid - The conversation ID
 * @param {number} timeInMillis - The time in milliseconds
 * @returns {Promise<void>}
 */
async function maybeAddNotificationTask(zid, timeInMillis) {
  await queryP('insert into notification_tasks (zid, modified) values ($1, $2) on conflict (zid) do nothing;', [
    zid,
    timeInMillis
  ]);
}

/**
 * Claim the next notification task
 * @returns {Promise<Object|null>} - The notification task or null if none available
 */
async function claimNextNotificationTask() {
  const rows = await queryP(
    'delete from notification_tasks where zid = (select zid from notification_tasks order by random() for update skip locked limit 1) returning *;'
  );
  return rows?.length ? rows[0] : null;
}

/**
 * Get the current database time
 * @returns {Promise<number>} - The current time in milliseconds
 */
async function getDbTime() {
  const rows = await queryP_readOnly('select now_as_millis();', []);
  return rows[0].now_as_millis;
}

/**
 * Get notification candidates for a conversation
 * @param {number} zid - The conversation ID
 * @param {number} timeOfLastEvent - The time of the last event
 * @returns {Promise<Array>} - Array of notification candidates
 */
async function getNotificationCandidates(zid, timeOfLastEvent) {
  return queryP_readOnly('select * from participants where zid = ($1) and last_notified < ($2) and subscribed > 0;', [
    zid,
    timeOfLastEvent
  ]);
}

/**
 * Get notification emails for participants
 * @param {Array<number>} pids - Array of participant IDs
 * @returns {Promise<Array>} - Array of user IDs and emails
 */
async function getNotificationEmails(pids) {
  return queryP_readOnly(
    `select uid, subscribe_email from participants_extended where uid in (select uid from participants where pid in (${pids.join(',')}));`,
    []
  );
}

/**
 * Update last notification time for a user in a conversation
 * @param {number} uid - The user ID
 * @param {number} zid - The conversation ID
 * @returns {Promise<void>}
 */
async function updateLastNotificationTime(uid, zid) {
  await queryP(
    'update participants set last_notified = now_as_millis(), nsli = nsli + 1 where uid = ($1) and zid = ($2);',
    [uid, zid]
  );
}

export {
  subscribeToNotifications,
  unsubscribeFromNotifications,
  addNotificationTask,
  maybeAddNotificationTask,
  claimNextNotificationTask,
  getDbTime,
  getNotificationCandidates,
  getNotificationEmails,
  updateLastNotificationTime
};
