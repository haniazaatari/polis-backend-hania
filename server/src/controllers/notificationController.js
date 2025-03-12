import * as pg from '../db/pg-query.js';
import { createNotificationsSubscribeUrl, createNotificationsUnsubscribeUrl } from '../email/notifications.js';
import { HMAC_SIGNATURE_PARAM_NAME, verifyHmacForQueryParams } from '../utils/hmac.js';
import { fail } from '../utils/responseHandlers.js';

const pgQueryP = pg.queryP;

/**
 * Handle GET request to subscribe to notifications
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
function handleNotificationsSubscribe(req, res) {
  const zid = req.p.zid;
  const email = req.p.email;
  const params = {
    conversation_id: req.p.conversation_id,
    email: req.p.email
  };
  params[HMAC_SIGNATURE_PARAM_NAME] = req.p[HMAC_SIGNATURE_PARAM_NAME];

  verifyHmacForQueryParams('api/v3/notifications/subscribe', params)
    .then(
      () => {
        return pgQueryP(
          'update participants set subscribed = 1 where uid = (select uid from users where email = ($2)) and zid = ($1);',
          [zid, email]
        ).then(() => {
          res.set('Content-Type', 'text/html');
          res.send(`<h1>Subscribed!</h1>
<p>
<a href="${createNotificationsUnsubscribeUrl(req.p.conversation_id, req.p.email)}">oops, unsubscribe me.</a>
</p>`);
        });
      },
      () => {
        fail(res, 403, 'polis_err_subscribe_signature_mismatch');
      }
    )
    .catch((err) => {
      fail(res, 500, 'polis_err_subscribe_misc', err);
    });
}

/**
 * Handle GET request to unsubscribe from notifications
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
function handleNotificationsUnsubscribe(req, res) {
  const zid = req.p.zid;
  const email = req.p.email;
  const params = {
    conversation_id: req.p.conversation_id,
    email: email
  };
  params[HMAC_SIGNATURE_PARAM_NAME] = req.p[HMAC_SIGNATURE_PARAM_NAME];

  verifyHmacForQueryParams('api/v3/notifications/unsubscribe', params)
    .then(
      () => {
        return pgQueryP(
          'update participants set subscribed = 0 where uid = (select uid from users where email = ($2)) and zid = ($1);',
          [zid, email]
        ).then(() => {
          res.set('Content-Type', 'text/html');
          res.send(`<h1>Unsubscribed.</h1>
<p>
<a href="${createNotificationsSubscribeUrl(req.p.conversation_id, req.p.email)}">oops, subscribe me again.</a>
</p>`);
        });
      },
      () => {
        fail(res, 403, 'polis_err_unsubscribe_signature_mismatch');
      }
    )
    .catch((err) => {
      fail(res, 500, 'polis_err_unsubscribe_misc', err);
    });
}

export { handleNotificationsSubscribe, handleNotificationsUnsubscribe };
