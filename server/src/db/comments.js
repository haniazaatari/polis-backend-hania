import polisTypes from '../utils/polisTypes.js';
import { queryP, queryP_readOnly } from './pg-query.js';
import * as SQL from './sql.js';

/**
 * Get the number of comments with a specific moderation status
 * @param {number} zid - The conversation ID
 * @param {number} mod - The moderation status
 * @returns {Promise<number>} - The number of comments
 */
async function getNumberOfCommentsWithModerationStatus(zid, mod) {
  const result = await queryP_readOnly('SELECT COUNT(*) FROM comments WHERE zid = ($1) AND mod = ($2);', [zid, mod]);
  let count = result?.[0]?.count;
  count = Number(count);
  if (Number.isNaN(count)) {
    return undefined;
  }
  return count;
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

/**
 * Check if a comment already exists in the conversation
 * @param {number} zid - The conversation ID
 * @param {string} txt - The comment text
 * @returns {Promise<boolean>} - True if the comment already exists
 */
async function commentExists(zid, txt) {
  const rows = await queryP_readOnly('SELECT zid FROM comments WHERE zid = ($1) AND txt = ($2);', [zid, txt]);
  return !!rows?.length;
}

/**
 * Create a new comment
 * @param {Object} params - Comment parameters
 * @param {number} params.pid - The participant ID
 * @param {number} params.zid - The conversation ID
 * @param {string} params.txt - The comment text
 * @param {number} params.velocity - The comment velocity
 * @param {boolean} params.active - Whether the comment is active
 * @param {number} params.mod - The moderation status
 * @param {number} params.uid - The user ID
 * @param {boolean} params.anon - Whether the comment is anonymous
 * @param {boolean} params.is_seed - Whether the comment is a seed
 * @param {string} params.lang - The comment language
 * @param {number} params.lang_confidence - The language detection confidence
 * @returns {Promise<Object>} - The created comment
 */
async function createComment(params) {
  const { pid, zid, txt, velocity, active, mod, uid, anon = false, is_seed = false, lang, lang_confidence } = params;

  const results = await queryP(
    `INSERT INTO COMMENTS
    (pid, zid, txt, velocity, active, mod, uid, anon, is_seed, created, tid, lang, lang_confidence)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, default, null, $10, $11)
    RETURNING *;`,
    [pid, zid, txt, velocity, active, mod, uid, anon, is_seed, lang, lang_confidence]
  );

  return results[0];
}

/**
 * Get a comment by its ID
 * @param {number} zid - Conversation ID
 * @param {number} tid - Comment ID
 * @returns {Promise<Object|null>} - Comment or null if not found
 */
async function getCommentByIdFromDb(zid, tid) {
  const results = await queryP_readOnly('SELECT * FROM comments WHERE zid = ($1) AND tid = ($2);', [zid, tid]);
  return results.length ? results[0] : null;
}

/**
 * Update a comment's moderation status in the database
 * @param {number} zid - Conversation ID
 * @param {number} tid - Comment ID
 * @param {boolean} active - Whether the comment is active
 * @param {number} mod - Moderation status
 * @param {boolean} is_meta - Whether the comment is meta
 * @returns {Promise<Object>} - Result of the moderation
 */
async function updateCommentModeration(zid, tid, active, mod, is_meta) {
  const query = 'UPDATE comments SET active = $1, mod = $2, is_meta = $3 WHERE zid = $4 AND tid = $5';
  const params = [active, mod, is_meta, zid, tid];
  return await queryP(query, params);
}

/**
 * Get comments for moderation from the database
 * @param {Object} options - Query options
 * @returns {Promise<Array>} - Comments
 */
async function getCommentsForModerationFromDb(options) {
  let modClause = '';
  const params = [options.zid];

  if (options.mod !== undefined) {
    modClause = ' AND comments.mod = ($2)';
    params.push(options.mod);
  } else if (options.mod_gt !== undefined) {
    modClause = ' AND comments.mod > ($2)';
    params.push(options.mod_gt);
  } else if (options.modIn !== undefined) {
    if (options.modIn === true) {
      if (options.strict_moderation) {
        modClause = ' AND comments.mod > 0';
      } else {
        modClause = ' AND comments.mod >= 0';
      }
    } else if (options.modIn === false) {
      if (options.strict_moderation) {
        modClause = ' AND comments.mod <= 0';
      } else {
        modClause = ' AND comments.mod < 0';
      }
    }
  }

  if (!options.include_voting_patterns) {
    return await queryP_readOnly(`SELECT * FROM comments WHERE comments.zid = ($1)${modClause}`, params);
  }

  return await queryP_readOnly(
    `SELECT * FROM (SELECT tid, vote, count(*) FROM votes_latest_unique WHERE zid = ($1) GROUP BY tid, vote) AS foo FULL OUTER JOIN comments ON foo.tid = comments.tid WHERE comments.zid = ($1)${modClause}`,
    params
  );
}

/**
 * Get comments list from the database
 * @param {Object} options - Query options
 * @returns {Promise<Array>} - Comments
 */
async function getCommentsListFromDb(options) {
  let query = SQL.sql_comments.select(SQL.sql_comments.star()).where(SQL.sql_comments.zid.equals(options.zid));

  if (options.pid !== undefined) {
    query = query.and(SQL.sql_comments.pid.equals(options.pid));
  }

  if (options.tids !== undefined) {
    query = query.and(SQL.sql_comments.tid.in(options.tids));
  }

  if (options.mod !== undefined) {
    query = query.and(SQL.sql_comments.mod.equals(options.mod));
  }

  if (options.not_voted_by_pid !== undefined) {
    query = query.and(
      SQL.sql_comments.tid.notIn(
        SQL.sql_votes_latest_unique
          .subQuery()
          .select(SQL.sql_votes_latest_unique.tid)
          .where(SQL.sql_votes_latest_unique.zid.equals(options.zid))
          .and(SQL.sql_votes_latest_unique.pid.equals(options.not_voted_by_pid))
      )
    );
  }

  if (options.withoutTids !== undefined) {
    query = query.and(SQL.sql_comments.tid.notIn(options.withoutTids));
  }

  query = query.and(SQL.sql_comments.active.equals(true));

  if (options.strict_moderation) {
    query = query.and(SQL.sql_comments.mod.equals(polisTypes.mod.ok));
  } else {
    query = query.and(SQL.sql_comments.mod.notEquals(polisTypes.mod.ban));
  }

  query = query.and(SQL.sql_comments.velocity.gt(0));

  if (options.random !== undefined) {
    if (options.prioritize_seed) {
      query = query.order('is_seed desc, random()');
    } else {
      query = query.order('random()');
    }
  } else {
    query = query.order(SQL.sql_comments.created);
  }

  if (options.limit !== undefined) {
    query = query.limit(options.limit);
  } else {
    query = query.limit(999);
  }

  const results = await queryP_readOnly(query.toString(), []);
  return results || [];
}

/**
 * Get number of comments remaining from the database
 * @param {number} zid - Conversation ID
 * @param {number} pid - Participant ID
 * @returns {Promise<Array>} - Remaining comments info
 */
async function getNumberOfCommentsRemainingFromDb(zid, pid) {
  const results = await queryP_readOnly(
    'WITH ' +
      'v AS (SELECT * FROM votes_latest_unique WHERE zid = ($1) AND pid = ($2)), ' +
      'c AS (SELECT * FROM get_visible_comments($1)), ' +
      'remaining AS (SELECT count(*) AS remaining FROM c LEFT JOIN v ON c.tid = v.tid WHERE v.vote IS NULL), ' +
      'total AS (SELECT count(*) AS total FROM c) ' +
      'SELECT cast(remaining.remaining AS integer), cast(total.total AS integer), cast(($2) AS integer) AS pid FROM remaining, total;',
    [zid, pid]
  );

  return results.length
    ? results
    : [
        {
          remaining: 0,
          total: 0,
          pid: pid
        }
      ];
}

/**
 * Store a comment translation in the database
 * @param {number} zid - Conversation ID
 * @param {number} tid - Comment ID
 * @param {string} translation - Translated text
 * @param {string} lang - Language code
 * @param {number} src - Source
 * @returns {Promise<Object|null>} - Stored translation
 */
async function storeCommentTranslationInDb(zid, tid, translation, lang, src) {
  const results = await queryP(
    'INSERT INTO comment_translations (zid, tid, txt, lang, src) VALUES ($1, $2, $3, $4, $5) RETURNING *;',
    [zid, tid, translation, lang, src]
  );

  return results.length ? results[0] : null;
}

/**
 * Get translations for a comment from the database
 * @param {number} zid - Conversation ID
 * @param {number} tid - Comment ID
 * @returns {Promise<Array>} - Array of translations
 */
async function getCommentTranslationsFromDb(zid, tid) {
  return await queryP_readOnly('select * from comment_translations where zid = ($1) and tid = ($2);', [zid, tid]);
}

/**
 * Get comments without language detection
 * @returns {Promise<Array>} Array of comments without language set
 */
async function getCommentsWithoutLanguage() {
  return await queryP('select tid, txt, zid from comments where lang is null;', []);
}

/**
 * Update comment language
 * @param {string} language - Detected language code
 * @param {number} confidence - Language detection confidence
 * @param {number} zid - Conversation ID
 * @param {number} tid - Comment ID
 * @returns {Promise<void>}
 */
async function updateCommentLanguage(language, confidence, zid, tid) {
  await queryP('update comments set lang = ($1), lang_confidence = ($2) where zid = ($3) and tid = ($4)', [
    language,
    confidence,
    zid,
    tid
  ]);
}

/**
 * Get author UIDs for featured comments
 * @param {number} zid - Conversation ID
 * @param {Array<number>} tids - Array of comment IDs
 * @returns {Promise<Array<number>>} - Array of author UIDs
 */
async function getAuthorUidsForComments(zid, tids) {
  if (!tids || tids.length === 0) {
    return [];
  }

  const q = `with authors as (select distinct(uid) from comments where zid = ($1) and tid in (${tids.join(',')}) order by uid) select authors.uid from authors union select authors.uid from authors inner join xids on xids.uid = authors.uid order by uid;`;
  const comments = await queryP(q, [zid]);
  return comments.map((c) => c.uid);
}

export {
  addNoMoreCommentsRecord,
  commentExists,
  createComment,
  getAuthorUidsForComments,
  getCommentByIdFromDb,
  getCommentsForModerationFromDb,
  getCommentsListFromDb,
  getCommentsWithoutLanguage,
  getCommentTranslationsFromDb,
  getNumberOfCommentsRemainingFromDb,
  getNumberOfCommentsWithModerationStatus,
  storeCommentTranslationInDb,
  updateCommentLanguage,
  updateCommentModeration
};
