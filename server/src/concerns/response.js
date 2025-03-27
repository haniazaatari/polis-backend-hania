import { fail } from './utils/fail.js';
import { getZinvite, getZinvites } from './utils/zinvite.js';

function addConversationId(o, dontUseCache) {
  if (!o.zid) {
    return Promise.resolve(o);
  }
  return getZinvite(o.zid, dontUseCache).then((conversation_id) => {
    o.conversation_id = conversation_id;
    return o;
  });
}
function addConversationIds(a) {
  const zids = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i].zid) {
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
function finishOne(res, o, dontUseCache, altStatusCode) {
  addConversationId(o, dontUseCache)
    .then(
      (item) => {
        if (item.zid) {
          item.zid = undefined;
        }
        const statusCode = altStatusCode || 200;
        res.status(statusCode).json(item);
      },
      (err) => {
        fail(res, 500, 'polis_err_finishing_responseA', err);
      }
    )
    .catch((err) => {
      fail(res, 500, 'polis_err_finishing_response', err);
    });
}
function finishArray(res, a) {
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

export default {
  finishOne,
  finishArray
};
