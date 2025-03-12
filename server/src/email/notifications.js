import { encode } from 'html-entities';
import _ from 'underscore';
import Config from '../config.js';
import * as pg from '../db/pg-query.js';
import { getNumberOfCommentsRemaining } from '../services/comment/commentService.js';
import { getConversationInfo } from '../services/conversation/conversationService.js';
import { getZinvite } from '../services/zinvite/zinviteService.js';
import { isPolisDev } from '../utils/common.js';
import { HMAC_SIGNATURE_PARAM_NAME, createHmacForQueryParams } from '../utils/hmac.js';
import logger from '../utils/logger.js';
import { paramsToStringSortedByName } from '../utils/parameter.js';
import { sendEmailByUid } from './senders.js';

const pgQueryP = pg.queryP;
const serverUrl = Config.getServerNameWithProtocol();

/**
 * Helper function that processes an array of items sequentially using promises
 * @param {Array} items - Array of items to process
 * @param {Function} asyncFn - Function to apply to each item that returns a promise
 * @returns {Promise<Array>} - Promise resolving to array of results
 */
async function mapSeriesAsync(items, asyncFn) {
  const results = [];
  for (const item of items) {
    const result = await asyncFn(item);
    results.push(result);
  }
  return results;
}

/**
 * Helper function to sequentially process each item in an array using promises
 * @param {Array} items - Array of items to process
 * @param {Function} asyncFn - Function to apply to each item that returns a promise
 * @returns {Promise<Array>} - Promise resolving to the original array
 */
async function forEachAsync(items, asyncFn) {
  for (const item of items) {
    await asyncFn(item);
  }
  return items;
}

/**
 * Subscribe a user to notifications for a conversation
 * @param {number} zid - The conversation ID
 * @param {number} uid - The user ID
 * @param {string} email - The user's email
 * @returns {Promise<void>}
 */
function subscribeToNotifications(zid, uid, email) {
  const type = 1;
  logger.info('subscribeToNotifications', { zid, uid });
  return pgQueryP('update participants_extended set subscribe_email = ($3) where zid = ($1) and uid = ($2);', [
    zid,
    uid,
    email
  ]).then(() =>
    pgQueryP('update participants set subscribed = ($3) where zid = ($1) and uid = ($2);', [zid, uid, type]).then(
      (_rows) => type
    )
  );
}

/**
 * Unsubscribe a user from notifications for a conversation
 * @param {number} zid - The conversation ID
 * @param {number} uid - The user ID
 * @returns {Promise<void>}
 */
function unsubscribeFromNotifications(zid, uid) {
  const type = 0;
  return pgQueryP('update participants set subscribed = ($3) where zid = ($1) and uid = ($2);', [zid, uid, type]).then(
    (_rows) => type
  );
}

/**
 * Add a notification task for a conversation
 * @param {number} zid - The conversation ID
 * @returns {Promise<void>}
 */
function addNotificationTask(zid) {
  return pgQueryP(
    'insert into notification_tasks (zid) values ($1) on conflict (zid) do update set modified = now_as_millis();',
    [zid]
  );
}

/**
 * Add a notification task for a conversation
 * @param {number} zid - The conversation ID
 * @param {number} timeInMillis - The time in milliseconds
 * @returns {Promise<void>}
 */
function maybeAddNotificationTask(zid, timeInMillis) {
  return pgQueryP('insert into notification_tasks (zid, modified) values ($1, $2) on conflict (zid) do nothing;', [
    zid,
    timeInMillis
  ]);
}

/**
 * Claim the next notification task
 * @returns {Promise<Object|null>} - The notification task or null if none available
 */
function claimNextNotificationTask() {
  return pgQueryP(
    'delete from notification_tasks where zid = (select zid from notification_tasks order by random() for update skip locked limit 1) returning *;'
  ).then((rows) => {
    if (!rows || !rows.length) {
      return null;
    }
    return rows[0];
  });
}

/**
 * Get the current database time
 * @returns {Promise<number>} - The current time in milliseconds
 */
function getDbTime() {
  return pgQueryP('select now_as_millis();', []).then((rows) => {
    return rows[0].now_as_millis;
  });
}

/**
 * Process notifications for a conversation
 * @param {number} zid - The conversation ID
 * @param {number} timeOfLastEvent - The time of the last event
 * @returns {Promise<void>}
 */
function doNotificationsForZid(zid, timeOfLastEvent) {
  let shouldTryAgain = false;
  return pgQueryP('select * from participants where zid = ($1) and last_notified < ($2) and subscribed > 0;', [
    zid,
    timeOfLastEvent
  ])
    .then((candidates) => {
      if (!candidates || !candidates.length) {
        return null;
      }
      const processedCandidates = candidates.map((ptpt) => {
        return {
          ...ptpt,
          last_notified: Number(ptpt.last_notified),
          last_interaction: Number(ptpt.last_interaction)
        };
      });
      return Promise.all([getDbTime(), getConversationInfo(zid), getZinvite(zid)]).then((a) => {
        const dbTimeMillis = a[0];
        const conv = a[1];
        const conversation_id = a[2];
        const url = conv.parent_url || `https://pol.is/${conversation_id}`;
        const pid_to_ptpt = {};
        for (const c of processedCandidates) {
          pid_to_ptpt[c.pid] = c;
        }
        return mapSeriesAsync(processedCandidates, (item) => {
          return getNumberOfCommentsRemaining(item.zid, item.pid).then((rows) => {
            return rows[0];
          });
        }).then((results) => {
          const needNotification = results.filter((result) => {
            const ptpt = pid_to_ptpt[result.pid];
            let needs = true;
            needs = needs && result.remaining > 0;
            let waitTime = 60 * 60 * 1000;
            if (ptpt.nsli === 0) {
              waitTime = 60 * 60 * 1000;
            } else if (ptpt.nsli === 1) {
              waitTime = 2 * 60 * 60 * 1000;
            } else if (ptpt.nsli === 2) {
              waitTime = 24 * 60 * 60 * 1000;
            } else if (ptpt.nsli === 3) {
              waitTime = 48 * 60 * 60 * 1000;
            } else {
              needs = false;
            }
            if (needs && dbTimeMillis < ptpt.last_notified + waitTime) {
              shouldTryAgain = true;
              needs = false;
            }
            if (needs && dbTimeMillis < ptpt.last_interaction + 5 * 60 * 1000) {
              shouldTryAgain = true;
              needs = false;
            }
            if (Config.devMode) {
              needs = needs && isPolisDev(ptpt.uid);
            }
            return needs;
          });
          if (needNotification.length === 0) {
            return null;
          }
          const pids = _.pluck(needNotification, 'pid');
          return pgQueryP(
            `select uid, subscribe_email from participants_extended where uid in (select uid from participants where pid in (${pids.join(',')}));`,
            []
          ).then((rows) => {
            const uidToEmail = {};
            for (const row of rows) {
              uidToEmail[row.uid] = row.subscribe_email;
            }
            return forEachAsync(needNotification, (item) => {
              const uid = pid_to_ptpt[item.pid].uid;
              return sendNotificationEmail(uid, url, conversation_id, uidToEmail[uid], item.remaining).then(() => {
                return pgQueryP(
                  'update participants set last_notified = now_as_millis(), nsli = nsli + 1 where uid = ($1) and zid = ($2);',
                  [uid, zid]
                );
              });
            });
          });
        });
      });
    })
    .then(() => {
      return shouldTryAgain;
    });
}

/**
 * Process a batch of notifications
 * @returns {Promise<void>}
 */
function doNotificationBatch() {
  return claimNextNotificationTask().then((task) => {
    if (!task) {
      return Promise.resolve();
    }
    return doNotificationsForZid(task.zid, task.modified).then((shouldTryAgain) => {
      if (shouldTryAgain) {
        maybeAddNotificationTask(task.zid, task.modified);
      }
    });
  });
}

/**
 * Start the notification processing loop
 */
function doNotificationLoop() {
  logger.debug('doNotificationLoop');
  doNotificationBatch().then(() => {
    setTimeout(doNotificationLoop, 10000);
  });
}

/**
 * Send a notification email to a user
 * @param {number} uid - The user ID
 * @param {string} url - The conversation URL
 * @param {string} conversation_id - The conversation ID
 * @param {string} email - The user's email
 * @param {number} remaining - The number of remaining comments
 * @returns {Promise<void>}
 */
function sendNotificationEmail(uid, url, conversation_id, email, _remaining) {
  const subject = `New statements to vote on (conversation ${conversation_id})`;
  let body = 'There are new statements available for you to vote on here:\n';
  body += '\n';
  body += `${url}\n`;
  body += '\n';
  body +=
    "You're receiving this message because you're signed up to receive Polis notifications for this conversation. You can unsubscribe from these emails by clicking this link:\n";
  body += `${createNotificationsUnsubscribeUrl(conversation_id, email)}\n`;
  body += '\n';
  body +=
    "If for some reason the above link does not work, please reply directly to this email with the message 'Unsubscribe' and we will remove you within 24 hours.";
  body += '\n';
  body += 'Thanks for your participation';
  return sendEmailByUid(uid, subject, body);
}

const shouldSendNotifications = !Config.devMode;
if (shouldSendNotifications) {
  doNotificationLoop();
}

/**
 * Create a URL for unsubscribing from notifications
 * @param {string} conversation_id - The conversation ID
 * @param {string} email - The user's email
 * @returns {string} - The unsubscribe URL
 */
function createNotificationsUnsubscribeUrl(conversation_id, email) {
  const params = {
    conversation_id: conversation_id,
    email: encode(email)
  };
  const path = 'api/v3/notifications/unsubscribe';
  params[HMAC_SIGNATURE_PARAM_NAME] = createHmacForQueryParams(path, params);
  const server = serverUrl;
  return `${server}/${path}?${paramsToStringSortedByName(params)}`;
}

/**
 * Create a URL for subscribing to notifications
 * @param {string} conversation_id - The conversation ID
 * @param {string} email - The user's email
 * @returns {string} - The subscribe URL
 */
function createNotificationsSubscribeUrl(conversation_id, email) {
  const params = {
    conversation_id: conversation_id,
    email: encode(email)
  };
  const path = 'api/v3/notifications/subscribe';
  params[HMAC_SIGNATURE_PARAM_NAME] = createHmacForQueryParams(path, params);
  const server = serverUrl;
  return `${server}/${path}?${paramsToStringSortedByName(params)}`;
}

// Start the notification loop
setTimeout(doNotificationLoop, 10000);

export {
  addNotificationTask,
  claimNextNotificationTask,
  createNotificationsSubscribeUrl,
  createNotificationsUnsubscribeUrl,
  doNotificationBatch,
  doNotificationLoop,
  doNotificationsForZid,
  getDbTime,
  maybeAddNotificationTask,
  sendNotificationEmail,
  subscribeToNotifications,
  unsubscribeFromNotifications
};
