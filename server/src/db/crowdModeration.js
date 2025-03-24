import { queryP } from './pg-query.js';

/**
 * Create a crowd moderation record
 * @param {Object} params - The crowd moderation parameters
 * @param {number} params.zid - The conversation ID
 * @param {number} params.pid - The participant ID
 * @param {number} params.tid - The comment ID
 * @param {boolean} params.as_abusive - Flagged as abusive
 * @param {boolean} params.as_factual - Flagged as factual
 * @param {boolean} params.as_feeling - Flagged as feeling
 * @param {boolean} params.as_important - Flagged as important
 * @param {boolean} params.as_notfact - Flagged as not fact
 * @param {boolean} params.as_notgoodidea - Flagged as not a good idea
 * @param {boolean} params.as_notmyfeeling - Flagged as not my feeling
 * @param {boolean} params.as_offtopic - Flagged as off-topic
 * @param {boolean} params.as_spam - Flagged as spam
 * @param {boolean} params.as_unsure - Flagged as unsure
 * @returns {Promise<Date>} - The creation timestamp
 */
async function createCrowdModerationRecord(params) {
  const {
    zid,
    pid,
    tid,
    as_abusive,
    as_factual,
    as_feeling,
    as_important,
    as_notfact,
    as_notgoodidea,
    as_notmyfeeling,
    as_offtopic,
    as_spam,
    as_unsure
  } = params;

  const result = await queryP(
    'INSERT INTO crowd_mod (' +
      'zid, ' +
      'pid, ' +
      'tid, ' +
      'as_abusive, ' +
      'as_factual, ' +
      'as_feeling, ' +
      'as_important, ' +
      'as_notfact, ' +
      'as_notgoodidea, ' +
      'as_notmyfeeling, ' +
      'as_offtopic, ' +
      'as_spam, ' +
      'as_unsure) VALUES (' +
      '$1, ' +
      '$2, ' +
      '$3, ' +
      '$4, ' +
      '$5, ' +
      '$6, ' +
      '$7, ' +
      '$8, ' +
      '$9, ' +
      '$10, ' +
      '$11, ' +
      '$12, ' +
      '$13) RETURNING created;',
    [
      zid,
      pid,
      tid,
      as_abusive,
      as_factual,
      as_feeling,
      as_important,
      as_notfact,
      as_notgoodidea,
      as_notmyfeeling,
      as_offtopic,
      as_spam,
      as_unsure
    ]
  );

  return result[0]?.created;
}

export { createCrowdModerationRecord };
