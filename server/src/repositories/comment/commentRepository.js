import { queryP, queryP_metered_readOnly, queryP_readOnly } from '../../db/pg-query.js';
import * as SQL from '../../db/sql.js';
import logger from '../../utils/logger.js';
import polisTypes from '../../utils/polisTypes.js';

/**
 * Get a comment by ID
 * @param {number} zid - Conversation ID
 * @param {number} tid - Comment ID
 * @returns {Promise<Object|null>} - Comment or null if not found
 */
async function getCommentById(zid, tid) {
  try {
    const results = await queryP_readOnly('SELECT * FROM comments WHERE zid = ($1) AND tid = ($2);', [zid, tid]);
    return results.length ? results[0] : null;
  } catch (error) {
    logger.error('Error getting comment by ID', error);
    throw error;
  }
}

/**
 * Get comments for moderation
 * @param {Object} options - Query options
 * @param {number} options.zid - Conversation ID
 * @param {number} [options.mod] - Moderation status
 * @param {number} [options.mod_gt] - Moderation status greater than
 * @param {boolean} [options.modIn] - Moderation status in
 * @param {boolean} [options.include_voting_patterns] - Include voting patterns
 * @param {boolean} [options.strict_moderation] - Strict moderation
 * @returns {Promise<Array>} - Comments
 */
async function getCommentsForModeration(options) {
  try {
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
      return await queryP_metered_readOnly(
        '_getCommentsForModerationList',
        `SELECT * FROM comments WHERE comments.zid = ($1)${modClause}`,
        params
      );
    }

    const rows = await queryP_metered_readOnly(
      '_getCommentsForModerationList',
      `SELECT * FROM (SELECT tid, vote, count(*) FROM votes_latest_unique WHERE zid = ($1) GROUP BY tid, vote) AS foo FULL OUTER JOIN comments ON foo.tid = comments.tid WHERE comments.zid = ($1)${modClause}`,
      params
    );

    return processVotingPatterns(rows);
  } catch (error) {
    logger.error('Error getting comments for moderation', error);
    throw error;
  }
}

/**
 * Process voting patterns for comments
 * @param {Array} rows - Comment rows with voting data
 * @returns {Array} - Processed comments with voting statistics
 * @private
 */
function processVotingPatterns(rows) {
  const votingStats = {};

  // Aggregate voting statistics by comment ID
  for (const row of rows) {
    if (!votingStats[row.tid]) {
      votingStats[row.tid] = {
        agree_count: 0,
        disagree_count: 0,
        pass_count: 0
      };
    }

    const stats = votingStats[row.tid];
    if (row.vote === polisTypes.reactions.pull) {
      stats.agree_count = Number(row.count);
    } else if (row.vote === polisTypes.reactions.push) {
      stats.disagree_count = Number(row.count);
    } else if (row.vote === polisTypes.reactions.pass) {
      stats.pass_count = Number(row.count);
    }
  }

  // Get unique rows by tid and add voting statistics
  const uniqueRows = [];
  const processedTids = new Set();

  for (const row of rows) {
    if (!processedTids.has(row.tid)) {
      processedTids.add(row.tid);

      const stats = votingStats[row.tid];
      row.agree_count = stats.agree_count;
      row.disagree_count = stats.disagree_count;
      row.pass_count = stats.pass_count;
      row.count = stats.agree_count + stats.disagree_count + stats.pass_count;

      uniqueRows.push(row);
    }
  }

  return uniqueRows;
}

/**
 * Get comments list
 * @param {Object} options - Query options
 * @param {number} options.zid - Conversation ID
 * @param {number} [options.pid] - Participant ID
 * @param {Array} [options.tids] - Comment IDs
 * @param {number} [options.mod] - Moderation status
 * @param {number} [options.not_voted_by_pid] - Not voted by participant ID
 * @param {Array} [options.withoutTids] - Exclude comment IDs
 * @param {boolean} [options.random] - Random order
 * @param {number} [options.limit] - Limit
 * @param {boolean} [options.strict_moderation] - Strict moderation
 * @param {boolean} [options.prioritize_seed] - Prioritize seed comments
 * @returns {Promise<Array>} - Comments
 */
async function getCommentsList(options) {
  try {
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
  } catch (error) {
    logger.error('Error getting comments list', error);
    throw error;
  }
}

/**
 * Get number of comments remaining for a participant
 * @param {number} zid - Conversation ID
 * @param {number} pid - Participant ID
 * @returns {Promise<Object>} - Remaining comments info
 */
async function getNumberOfCommentsRemaining(zid, pid) {
  try {
    const results = await queryP_readOnly(
      'WITH ' +
        'v AS (SELECT * FROM votes_latest_unique WHERE zid = ($1) AND pid = ($2)), ' +
        'c AS (SELECT * FROM get_visible_comments($1)), ' +
        'remaining AS (SELECT count(*) AS remaining FROM c LEFT JOIN v ON c.tid = v.tid WHERE v.vote IS NULL), ' +
        'total AS (SELECT count(*) AS total FROM c) ' +
        'SELECT cast(remaining.remaining AS integer), cast(total.total AS integer), cast(($2) AS integer) AS pid FROM remaining, total;',
      [zid, pid]
    );

    return results.length ? results[0] : null;
  } catch (error) {
    logger.error('Error getting number of comments remaining', error);
    throw error;
  }
}

/**
 * Store a translated comment
 * @param {number} zid - Conversation ID
 * @param {number} tid - Comment ID
 * @param {string} translation - Translated text
 * @param {string} lang - Language code
 * @param {number} src - Source (default: -1 for external translation)
 * @returns {Promise<Object>} - Stored translation
 */
async function storeCommentTranslation(zid, tid, translation, lang, src = -1) {
  try {
    const results = await queryP(
      'INSERT INTO comment_translations (zid, tid, txt, lang, src) VALUES ($1, $2, $3, $4, $5) RETURNING *;',
      [zid, tid, translation, lang, src]
    );

    return results.length ? results[0] : null;
  } catch (error) {
    logger.error('Error storing comment translation', error);
    throw error;
  }
}

/**
 * Get translations for a comment
 * @param {number} zid - Conversation ID
 * @param {number} tid - Comment ID
 * @returns {Promise<Array>} - Array of translations
 */
async function getCommentTranslations(zid, tid) {
  try {
    return await queryP_readOnly('select * from comment_translations where zid = ($1) and tid = ($2);', [zid, tid]);
  } catch (error) {
    logger.error('Error getting comment translations', error);
    return [];
  }
}

export {
  getCommentById,
  getCommentsForModeration,
  getCommentsList,
  getNumberOfCommentsRemaining,
  storeCommentTranslation,
  getCommentTranslations
};
