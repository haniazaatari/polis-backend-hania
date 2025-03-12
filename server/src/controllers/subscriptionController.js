import { subscribeToConversation, unsubscribeFromConversation } from '../services/subscription/subscriptionService.js';
import { fail } from '../utils/responseHandlers.js';

/**
 * Handle POST request to manage conversation subscriptions
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
function handlePostConvSubscriptions(req, res) {
  const zid = req.p.zid;
  const uid = req.p.uid;
  const type = req.p.type;
  const email = req.p.email;

  function finish(type) {
    res.status(200).json({
      subscribed: type
    });
  }

  if (type === 1) {
    subscribeToConversation(zid, uid, email)
      .then(finish)
      .catch((err) => {
        fail(res, 500, `polis_err_sub_conv ${zid} ${uid}`, err);
      });
  } else if (type === 0) {
    unsubscribeFromConversation(zid, uid)
      .then(finish)
      .catch((err) => {
        fail(res, 500, `polis_err_unsub_conv ${zid} ${uid}`, err);
      });
  } else {
    fail(res, 400, 'polis_err_bad_subscription_type', new Error('polis_err_bad_subscription_type'));
  }
}

export { handlePostConvSubscriptions };
