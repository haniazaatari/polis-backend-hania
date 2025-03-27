import BluebirdPromise from 'bluebird';
import _ from 'underscore';
import { getNumberOfCommentsRemaining } from '../comment.js';
import Config from '../config.js';
import { getConversationInfo } from '../conversation.js';
import { queryP as pgQueryP } from '../db/pg-query.js';
import Utils from '../utils/common.js';
import { fail } from '../utils/fail.js';
import logger from '../utils/logger.js';
import { getZinvite } from '../utils/zinvite.js';
import { emailTeam, sendNotificationEmail } from './email.js';

function getDbTime() {
  return pgQueryP('select now_as_millis();', []).then((rows) => {
    return rows[0].now_as_millis;
  });
}

function maybeAddNotificationTask(zid, timeInMillis) {
  return pgQueryP('insert into notification_tasks (zid, modified) values ($1, $2) on conflict (zid) do nothing;', [
    zid,
    timeInMillis
  ]);
}

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
      candidates = candidates.map((ptpt) => {
        ptpt.last_notified = Number(ptpt.last_notified);
        ptpt.last_interaction = Number(ptpt.last_interaction);
        return ptpt;
      });
      return Promise.all([getDbTime(), getConversationInfo(zid), getZinvite(zid)]).then((a) => {
        const dbTimeMillis = a[0];
        const conv = a[1];
        const conversation_id = a[2];
        const url = conv.parent_url || `https://pol.is/${conversation_id}`;
        const pid_to_ptpt = {};
        candidates.forEach((c) => {
          pid_to_ptpt[c.pid] = c;
        });
        return BluebirdPromise.mapSeries(candidates, (item, _index, _length) => {
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
              needs = needs && Utils.isPolisDev(ptpt.uid);
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
            rows.forEach((row) => {
              uidToEmail[row.uid] = row.subscribe_email;
            });
            return BluebirdPromise.each(needNotification, (item, _index, _length) => {
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

function doNotificationLoop() {
  logger.debug('doNotificationLoop');
  doNotificationBatch().then(() => {
    setTimeout(doNotificationLoop, 10000);
  });
}

function handle_POST_notifyTeam(req, res) {
  if (req.p.webserver_pass !== Config.webserverPass || req.p.webserver_username !== Config.webserverUsername) {
    return fail(res, 403, 'polis_err_notifyTeam_auth');
  }
  const subject = req.p.subject;
  const body = req.p.body;
  emailTeam(subject, body)
    .then(() => {
      res.status(200).json({});
    })
    .catch((err) => {
      return fail(res, 500, 'polis_err_notifyTeam', err);
    });
}

export default {
  doNotificationLoop,
  handle_POST_notifyTeam
};
