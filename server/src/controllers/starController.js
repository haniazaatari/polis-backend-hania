import { createStar } from '../services/star/starService.js';
import { isDuplicateKey } from '../utils/common.js';
import { fail } from '../utils/responseHandlers.js';

/**
 * Handle POST request to star a comment
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
function handlePostStars(req, res) {
  const zid = req.p.zid;
  const tid = req.p.tid;
  const pid = req.p.pid;
  const starred = req.p.starred;

  createStar(zid, tid, pid, starred)
    .then(() => {
      res.status(200).json({});
    })
    .catch((err) => {
      if (err) {
        if (isDuplicateKey(err)) {
          fail(res, 406, 'polis_err_vote_duplicate', err);
        } else {
          fail(res, 500, 'polis_err_vote', err);
        }
      }
    });
}

export { handlePostStars };
