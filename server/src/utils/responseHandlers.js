import { getZinvite, getZinvites } from '../services/zinvite/zinviteService.js';
import logger from './logger.js';
/**
 * Add conversation_id to each item in an array based on zid
 * @param {Array} a - Array of items with zid property
 * @returns {Promise<Array>} - Array of items with conversation_id property
 */
function addConversationIds(a) {
  logger.debug('addConversationIds', { a });

  // Handle undefined, null, or non-array input
  if (!a || !Array.isArray(a)) {
    logger.warn('addConversationIds received non-array input', { input: a });
    return Promise.resolve([]);
  }

  const zids = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i]?.zid) {
      zids.push(a[i].zid);
    }
  }
  if (!zids.length) {
    return Promise.resolve(a);
  }
  return getZinvites(zids).then((zid2conversation_id) =>
    a.map((o) => {
      o.conversation_id = zid2conversation_id[o.zid];
      return o;
    })
  );
}

/**
 * Add conversation_id to an item based on zid
 * @param {Object} o - Item with zid property
 * @param {boolean} [dontUseCache=false] - Whether to use cache
 * @returns {Promise<Object>} - Item with conversation_id property
 */
function addConversationId(o, dontUseCache) {
  if (!o.zid) {
    return Promise.resolve(o);
  }
  return getZinvite(o.zid, dontUseCache).then((conversation_id) => {
    o.conversation_id = conversation_id;
    return o;
  });
}

/**
 * Send a JSON response with an array of items
 * @param {object} res - Express response object
 * @param {Array} a - Array of items to send
 */
export function finishArray(res, a) {
  addConversationIds(a)
    .then(
      (items) => {
        if (items) {
          for (let i = 0; i < items.length; i++) {
            if (items[i].zid) {
              items[i].zid = undefined;
            }
          }
        }
        res.status(200).json(items);
      },
      (err) => {
        fail(res, 500, 'polis_err_finishing_response2A', err);
      }
    )
    .catch((err) => {
      fail(res, 500, 'polis_err_finishing_response2', err);
    });
}

/**
 * Send a JSON response with a single item
 * @param {object} res - Express response object
 * @param {object} o - Item to send
 * @param {boolean} [dontUseCache=false] - Whether to use cache
 * @param {number} [altStatusCode=200] - Alternative status code
 */
export function finishOne(res, o, dontUseCache = false, altStatusCode = 200) {
  addConversationId(o, dontUseCache)
    .then(
      (item) => {
        if (item.zid) {
          item.zid = undefined;
        }
        if (dontUseCache) {
          res.set({
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            Pragma: 'no-cache',
            Expires: '0'
          });
        }
        res.status(altStatusCode).json(item);
      },
      (err) => {
        fail(res, 500, 'polis_err_finishing_response1A', err);
      }
    )
    .catch((err) => {
      fail(res, 500, 'polis_err_finishing_response1', err);
    });
}

/**
 * Sends a failure response with the specified status code and error message
 * @param {Object} res - Express response object
 * @param {number} httpCode - HTTP status code
 * @param {string} clientVisibleErrorString - Error code for client
 * @param {Error|string} [err] - Optional error object or message for logging
 * @returns {Object} - The response object
 */
export function fail(res, httpCode, clientVisibleErrorString, err) {
  if (err) {
    logger.error(clientVisibleErrorString, err);
  }

  const status = httpCode || 500;

  // Return plain text error code to match legacy server behavior
  return res.status(status).send(clientVisibleErrorString);

  // TODO: Properly handle JSON responses:
  // return res.status(httpCode).json({
  //   error: clientVisibleErrorString
  // });
}
