import { getZinvite, getZinvites } from '../services/zinvite/zinviteService.js';
import logger from './logger.js';
/**
 * Add conversation_id to each item in an array based on zid
 * @param {Array} a - Array of items with zid property
 * @returns {Promise<Array>} - Array of items with conversation_id property
 */
async function addConversationIds(a) {
  logger.debug('addConversationIds', { a });

  // Handle undefined, null, or non-array input
  if (!a || !Array.isArray(a)) {
    logger.warn('addConversationIds received non-array input', { input: a });
    return [];
  }

  const zids = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i]?.zid) {
      zids.push(a[i].zid);
    }
  }
  if (!zids.length) {
    return a;
  }

  const zid2conversation_id = await getZinvites(zids);
  return a.map((o) => {
    o.conversation_id = zid2conversation_id[o.zid];
    return o;
  });
}

/**
 * Add conversation_id to an item based on zid
 * @param {Object} o - Item with zid property
 * @param {boolean} [dontUseCache=false] - Whether to use cache
 * @returns {Promise<Object>} - Item with conversation_id property
 */
async function addConversationId(o, dontUseCache) {
  if (!o.zid) {
    return o;
  }
  const conversation_id = await getZinvite(o.zid, dontUseCache);
  o.conversation_id = conversation_id;
  return o;
}

/**
 * Send a JSON response with an array of items
 * @param {object} res - Express response object
 * @param {Array} a - Array of items to send
 */
export async function finishArray(res, a) {
  try {
    const items = await addConversationIds(a);
    if (items) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].zid) {
          items[i].zid = undefined;
        }
      }
    }
    res.status(200).json(items);
  } catch (err) {
    fail(res, 500, 'polis_err_finishing_response2', err);
  }
}

/**
 * Send a JSON response with a single item
 * @param {object} res - Express response object
 * @param {object} o - Item to send
 * @param {boolean} [dontUseCache=false] - Whether to use cache
 * @param {number} [altStatusCode=200] - Alternative status code
 */
export async function finishOne(res, o, dontUseCache = false, altStatusCode = 200) {
  try {
    const item = await addConversationId(o, dontUseCache);
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
  } catch (err) {
    fail(res, 500, 'polis_err_finishing_response1', err);
  }
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
