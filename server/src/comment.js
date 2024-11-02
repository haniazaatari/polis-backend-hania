import { v2 } from '@google-cloud/translate';
import _ from 'underscore';
import Config from './config.js';
import Conversation from './conversation.js';
import pg from './db/pg-query.js';
import SQL from './db/sql.js';
import Utils from './utils/common.js';
import { MPromise } from './utils/metered.js';
const { Translate } = v2;
const useTranslateApi = Config.shouldUseTranslationAPI;
const translateClient = useTranslateApi ? new Translate() : null;
function getComment(zid, tid) {
  return pg.queryP('select * from comments where zid = ($1) and tid = ($2);', [zid, tid]).then((rows) => {
    return rows?.[0] || null;
  });
}
function getComments(o) {
  const commentListPromise = o.moderation ? _getCommentsForModerationList(o) : _getCommentsList(o);
  const convPromise = Conversation.getConversationInfo(o.zid);
  return Promise.all([convPromise, commentListPromise])
    .then((a) => {
      let rows = a[1];
      const cols = [
        'txt',
        'tid',
        'created',
        'uid',
        'tweet_id',
        'quote_src_url',
        'anon',
        'is_seed',
        'is_meta',
        'lang',
        'pid'
      ];
      if (o.moderation) {
        cols.push('velocity');
        cols.push('zid');
        cols.push('mod');
        cols.push('active');
        cols.push('agree_count');
        cols.push('disagree_count');
        cols.push('pass_count');
        cols.push('count');
      }
      rows = rows.map((row) => {
        const x = _.pick(row, cols);
        if (!_.isUndefined(x.count)) {
          x.count = Number(x.count);
        }
        return x;
      });
      return rows;
    })
    .then((comments) => {
      for (const c of comments) {
        c.uid = undefined;
        c.anon = undefined;
      }
      return comments;
    });
}
function _getCommentsForModerationList(o) {
  let strictCheck = Promise.resolve(null);
  const include_voting_patterns = o.include_voting_patterns;
  if (o.modIn) {
    strictCheck = pg.queryP('select strict_moderation from conversations where zid = ($1);', [o.zid]).then(() => {
      return o.strict_moderation;
    });
  }
  return strictCheck.then((strict_moderation) => {
    let modClause = '';
    const params = [o.zid];
    if (!_.isUndefined(o.mod)) {
      modClause = ' and comments.mod = ($2)';
      params.push(o.mod);
    } else if (!_.isUndefined(o.mod_gt)) {
      modClause = ' and comments.mod > ($2)';
      params.push(o.mod_gt);
    } else if (!_.isUndefined(o.modIn)) {
      if (o.modIn === true) {
        if (strict_moderation) {
          modClause = ' and comments.mod > 0';
        } else {
          modClause = ' and comments.mod >= 0';
        }
      } else if (o.modIn === false) {
        if (strict_moderation) {
          modClause = ' and comments.mod <= 0';
        } else {
          modClause = ' and comments.mod < 0';
        }
      }
    }
    if (!include_voting_patterns) {
      return pg.queryP_metered_readOnly(
        '_getCommentsForModerationList',
        `select * from comments where comments.zid = ($1)${modClause}`,
        params
      );
    }
    return pg
      .queryP_metered_readOnly(
        '_getCommentsForModerationList',
        `select * from (select tid, vote, count(*) from votes_latest_unique where zid = ($1) group by tid, vote) as foo full outer join comments on foo.tid = comments.tid where comments.zid = ($1)${modClause}`,
        params
      )
      .then((rows) => {
        const adp = {};
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          if (!adp[row.tid]) {
            adp[row.tid] = {
              agree_count: 0,
              disagree_count: 0,
              pass_count: 0
            };
          }
          const o = adp[row.tid];
          if (row.vote === Utils.polisTypes.reactions.pull) {
            o.agree_count = Number(row.count);
          } else if (row.vote === Utils.polisTypes.reactions.push) {
            o.disagree_count = Number(row.count);
          } else if (row.vote === Utils.polisTypes.reactions.pass) {
            o.pass_count = Number(row.count);
          }
        }
        const uniqueRows = _.uniq(rows, false, (row) => {
          return row.tid;
        });
        for (let i = 0; i < uniqueRows.length; i++) {
          const row = uniqueRows[i];
          row.agree_count = adp[row.tid].agree_count;
          row.disagree_count = adp[row.tid].disagree_count;
          row.pass_count = adp[row.tid].pass_count;
          row.count = row.agree_count + row.disagree_count + row.pass_count;
        }
        return uniqueRows;
      });
  });
}
function _getCommentsList(o) {
  return new MPromise('_getCommentsList', (resolve, reject) => {
    Conversation.getConversationInfo(o.zid).then((conv) => {
      let q = SQL.sql_comments.select(SQL.sql_comments.star()).where(SQL.sql_comments.zid.equals(o.zid));
      if (!_.isUndefined(o.pid)) {
        q = q.and(SQL.sql_comments.pid.equals(o.pid));
      }
      if (!_.isUndefined(o.tids)) {
        q = q.and(SQL.sql_comments.tid.in(o.tids));
      }
      if (!_.isUndefined(o.mod)) {
        q = q.and(SQL.sql_comments.mod.equals(o.mod));
      }
      if (!_.isUndefined(o.not_voted_by_pid)) {
        q = q.and(
          SQL.sql_comments.tid.notIn(
            SQL.sql_votes_latest_unique
              .subQuery()
              .select(SQL.sql_votes_latest_unique.tid)
              .where(SQL.sql_votes_latest_unique.zid.equals(o.zid))
              .and(SQL.sql_votes_latest_unique.pid.equals(o.not_voted_by_pid))
          )
        );
      }
      if (!_.isUndefined(o.withoutTids)) {
        q = q.and(SQL.sql_comments.tid.notIn(o.withoutTids));
      }
      q = q.and(SQL.sql_comments.active.equals(true));
      if (conv.strict_moderation) {
        q = q.and(SQL.sql_comments.mod.equals(Utils.polisTypes.mod.ok));
      } else {
        q = q.and(SQL.sql_comments.mod.notEquals(Utils.polisTypes.mod.ban));
      }
      q = q.and(SQL.sql_comments.velocity.gt(0));
      if (!_.isUndefined(o.random)) {
        if (conv.prioritize_seed) {
          q = q.order('is_seed desc, random()');
        } else {
          q = q.order('random()');
        }
      } else {
        q = q.order(SQL.sql_comments.created);
      }
      if (!_.isUndefined(o.limit)) {
        q = q.limit(o.limit);
      } else {
        q = q.limit(999);
      }
      return pg.query(q.toString(), [], (err, docs) => {
        if (err) {
          reject(err);
          return;
        }
        if (docs.rows?.length) {
          resolve(docs.rows);
        } else {
          resolve([]);
        }
      });
    });
  });
}
function getNumberOfCommentsRemaining(zid, pid) {
  return pg.queryP(
    'with ' +
      'v as (select * from votes_latest_unique where zid = ($1) and pid = ($2)), ' +
      'c as (select * from get_visible_comments($1)), ' +
      'remaining as (select count(*) as remaining from c left join v on c.tid = v.tid where v.vote is null), ' +
      'total as (select count(*) as total from c) ' +
      'select cast(remaining.remaining as integer), cast(total.total as integer), cast(($2) as integer) as pid from remaining, total;',
    [zid, pid]
  );
}
function translateAndStoreComment(zid, tid, txt, lang) {
  if (useTranslateApi) {
    return translateString(txt, lang).then((results) => {
      const translation = results[0];
      const src = -1;
      return pg
        .queryP(
          'insert into comment_translations (zid, tid, txt, lang, src) values ($1, $2, $3, $4, $5) returning *;',
          [zid, tid, translation, lang, src]
        )
        .then((rows) => {
          return rows[0];
        });
    });
  }
  return Promise.resolve(null);
}
function translateString(txt, target_lang) {
  if (useTranslateApi) {
    return translateClient.translate(txt, target_lang);
  }
  return Promise.resolve(null);
}
function detectLanguage(txt) {
  if (useTranslateApi) {
    return translateClient.detect(txt);
  }
  return Promise.resolve([
    {
      confidence: null,
      language: null
    }
  ]);
}
export default {
  getComment,
  getComments,
  _getCommentsForModerationList,
  _getCommentsList,
  getNumberOfCommentsRemaining,
  translateAndStoreComment,
  detectLanguage
};
