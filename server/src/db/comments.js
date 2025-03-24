import { MPromise } from '../utils/metered.js';
import { pgQueryP_readOnly, queryP } from './pg-query.js';

/**
 * Get the number of comments with a specific moderation status
 * @param {number} zid - The conversation ID
 * @param {number} mod - The moderation status
 * @returns {Promise<number>} - The number of comments
 */
function getNumberOfCommentsWithModerationStatus(zid, mod) {
  return MPromise('getNumberOfCommentsWithModerationStatus', (resolve, reject) => {
    pgQueryP_readOnly('SELECT COUNT(*) FROM comments WHERE zid = ($1) AND mod = ($2);', [zid, mod])
      .then((result) => {
        let count = result?.[0]?.count;
        count = Number(count);
        if (Number.isNaN(count)) {
          count = undefined;
        }
        resolve(count);
      })
      .catch((err) => {
        reject(err);
      });
  });
}

/**
 * Add a no more comments record
 * @param {number} zid - The conversation ID
 * @param {number} pid - The participant ID
 * @returns {Promise<void>}
 */
function addNoMoreCommentsRecord(zid, pid) {
  return queryP(
    'insert into event_ptpt_no_more_comments (zid, pid, votes_placed) values ($1, $2, ' +
      '(select count(*) from votes where zid = ($1) and pid = ($2)))',
    [zid, pid]
  );
}

export { getNumberOfCommentsWithModerationStatus, addNoMoreCommentsRecord };
