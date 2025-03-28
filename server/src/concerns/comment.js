import badwords from 'badwords';
import { google } from 'googleapis';
import _ from 'underscore';
import {
  detectLanguage,
  getComment,
  getComments,
  getNumberOfCommentsRemaining,
  translateAndStoreComment
} from '../comment.js';
import Config from '../config.js';
import { createXidRecordByZid, getConversationInfo } from '../conversation.js';
import { query, queryP, queryP_readOnly, query_readOnly } from '../db/pg-query.js';
import { votesPost } from '../routes/votes.js';
import { getPidPromise, getXidStuff } from '../user.js';
import { isModerator, isSpam, polisTypes } from '../utils/common.js';
import { fail } from '../utils/fail.js';
import logger from '../utils/logger.js';
import { MPromise } from '../utils/metered.js';
import { getPca } from '../utils/pca.js';
import { getZinvite } from '../utils/zinvite.js';
import {
  updateConversationModifiedTime,
  updateLastInteractionTimeForConversation,
  updateVoteCount
} from './conversation.js';
import { sendEmailByUid } from './email.js';
import { addParticipant } from './participant.js';
import { finishArray, finishOne } from './response.js';

const serverUrl = Config.getServerUrl();
const GOOGLE_DISCOVERY_URL = 'https://commentanalyzer.googleapis.com/$discovery/rest?version=v1alpha1';

function getNumberOfCommentsWithModerationStatus(zid, mod) {
  return new MPromise('getNumberOfCommentsWithModerationStatus', (resolve, reject) => {
    query_readOnly('select count(*) from comments where zid = ($1) and mod = ($2);', [zid, mod], (err, result) => {
      if (err) {
        reject(err);
      } else {
        let count = result?.rows?.[0]?.count;
        count = Number(count);
        if (Number.isNaN(count)) {
          count = void 0;
        }
        resolve(count);
      }
    });
  });
}

function sendCommentModerationEmail(_req, uid, zid, unmoderatedCommentCount) {
  if (_.isUndefined(unmoderatedCommentCount)) {
    unmoderatedCommentCount = '';
  }
  let body = unmoderatedCommentCount;
  if (unmoderatedCommentCount === 1) {
    body += ' Statement is waiting for your review here: ';
  } else {
    body += ' Statements are waiting for your review here: ';
  }
  getZinvite(zid)
    .catch((err) => {
      logger.error('polis_err_getting_zinvite', err);
      return void 0;
    })
    .then((zinvite) => {
      body += createModerationUrl(zinvite);
      body += '\n\nThank you for using Polis.';
      return sendEmailByUid(uid, `Waiting for review (conversation ${zinvite})`, body);
    })
    .catch((err) => {
      logger.error('polis_err_sending_email', err);
    });
}

function createModerationUrl(zinvite) {
  return `${serverUrl}/m/${zinvite}`;
}

function moderateComment(zid, tid, active, mod, is_meta) {
  return new Promise((resolve, reject) => {
    const updateQuery = 'UPDATE comments SET active = $1, mod = $2, is_meta = $3 WHERE zid = $4 AND tid = $5';
    const params = [active, mod, is_meta, zid, tid];
    logger.debug('Executing query:', { query: updateQuery });
    logger.debug('With parameters:', { params });
    query(updateQuery, params, (err, result) => {
      if (err) {
        logger.error('moderateComment query error:', err);
        reject(err);
      } else {
        logger.debug('moderateComment query executed successfully');
        resolve(result);
      }
    });
  });
}

function hasBadWords(txt) {
  txt = txt.toLowerCase();
  const tokens = txt.split(' ');
  for (let i = 0; i < tokens.length; i++) {
    if (badwords[tokens[i]]) {
      return true;
    }
  }
  return false;
}

function commentExists(zid, txt) {
  return queryP('select zid from comments where zid = ($1) and txt = ($2);', [zid, txt]).then((rows) => rows?.length);
}

async function analyzeComment(txt) {
  try {
    const client = await google.discoverAPI(GOOGLE_DISCOVERY_URL);
    const analyzeRequest = {
      comment: {
        text: txt
      },
      requestedAttributes: {
        TOXICITY: {}
      }
    };
    const response = await client.comments.analyze({
      key: Config.googleJigsawPerspectiveApiKey,
      resource: analyzeRequest
    });
    return response.data;
  } catch (err) {
    logger.error('analyzeComment error', err);
  }
}

function addNotificationTask(zid) {
  return queryP(
    'insert into notification_tasks (zid) values ($1) on conflict (zid) do update set modified = now_as_millis();',
    [zid]
  );
}

function selectProbabilistically(comments, priorities, _nTotal, _nRemaining) {
  const lookup = _.reduce(
    comments,
    (o, comment) => {
      const lookup_val = o.lastCount + (priorities[comment.tid] || 1);
      o.lookup.push([lookup_val, comment]);
      o.lastCount = lookup_val;
      return o;
    },
    { lastCount: 0, lookup: [] }
  );
  const randomN = Math.random() * lookup.lastCount;
  const result = _.find(lookup.lookup, (x) => x[0] > randomN);
  const c = result?.[1];
  c.randomN = randomN;
  return c;
}

function getNextPrioritizedComment(zid, pid, withoutTids, include_social) {
  const params = {
    zid: zid,
    not_voted_by_pid: pid,
    include_social: include_social
  };
  if (!_.isUndefined(withoutTids) && withoutTids.length) {
    params.withoutTids = withoutTids;
  }
  return Promise.all([getComments(params), getPca(zid, 0), getNumberOfCommentsRemaining(zid, pid)]).then((results) => {
    const comments = results[0];
    const math = results[1];
    const numberOfCommentsRemainingRows = results[2];
    logger.debug('getNextPrioritizedComment intermediate results:', {
      zid,
      pid,
      numberOfCommentsRemainingRows
    });
    if (!comments || !comments.length) {
      return null;
    }
    if (!numberOfCommentsRemainingRows || !numberOfCommentsRemainingRows.length) {
      throw new Error(`polis_err_getNumberOfCommentsRemaining_${zid}_${pid}`);
    }
    const commentPriorities = math ? math.asPOJO['comment-priorities'] || {} : {};
    const nTotal = Number(numberOfCommentsRemainingRows[0].total);
    const nRemaining = Number(numberOfCommentsRemainingRows[0].remaining);
    const c = selectProbabilistically(comments, commentPriorities, nTotal, nRemaining);
    c.remaining = nRemaining;
    c.total = nTotal;
    return c;
  });
}

function getCommentTranslations(zid, tid) {
  return queryP('select * from comment_translations where zid = ($1) and tid = ($2);', [zid, tid]);
}

function getNextComment(zid, pid, withoutTids, include_social, lang) {
  return getNextPrioritizedComment(zid, pid, withoutTids, include_social).then((c) => {
    if (lang && c) {
      const firstTwoCharsOfLang = lang.substr(0, 2);
      return getCommentTranslations(zid, c.tid).then((translations) => {
        c.translations = translations;
        const hasMatch = _.some(translations, (t) => {
          return t.lang.startsWith(firstTwoCharsOfLang);
        });
        if (!hasMatch) {
          return translateAndStoreComment(zid, c.tid, c.txt, lang).then((translation) => {
            if (translation) {
              c.translations.push(translation);
            }
            return c;
          });
        }
        return c;
      });
    }
    if (c) {
      c.translations = [];
    }
    return c;
  });
}

function addNoMoreCommentsRecord(zid, pid) {
  return queryP(
    'insert into event_ptpt_no_more_comments (zid, pid, votes_placed) values ($1, $2, ' +
      '(select count(*) from votes where zid = ($1) and pid = ($2)))',
    [zid, pid]
  );
}

async function handle_POST_comments(req, res) {
  let { zid, xid, uid, txt, pid: initialPid, vote, anon, is_seed } = req.p;
  let pid = initialPid;
  let currentPid = pid;
  const mustBeModerator = anon;
  if (!txt || txt === '') {
    fail(res, 400, 'polis_err_param_missing_txt');
    return;
  }
  async function doGetPid() {
    if (_.isUndefined(pid) || Number(pid) === -1) {
      const newPid = await getPidPromise(zid, uid, true);
      if (newPid === -1) {
        const rows = await addParticipant(zid, uid);
        const ptpt = rows[0];
        pid = ptpt.pid;
        currentPid = pid;
        return Number(pid);
      }
      return newPid;
    }
    return Number(pid);
  }
  try {
    logger.debug('Post comments txt', { zid, pid, txt });
    const ip =
      req.headers['x-forwarded-for'] ||
      req.connection?.remoteAddress ||
      req.socket?.remoteAddress ||
      req.connection?.socket?.remoteAddress;
    const isSpamPromise = isSpam({
      comment_content: txt,
      comment_author: uid,
      permalink: `https://pol.is/${zid}`,
      user_ip: ip,
      user_agent: req.headers['user-agent'],
      referrer: req.headers.referer
    }).catch((err) => {
      logger.error('isSpam failed', err);
      return false;
    });
    const jigsawModerationPromise = Config.googleJigsawPerspectiveApiKey ? analyzeComment(txt) : Promise.resolve(null);
    const isModeratorPromise = isModerator(zid, uid);
    const conversationInfoPromise = getConversationInfo(zid);
    let shouldCreateXidRecord = false;
    const pidPromise = (async () => {
      if (xid) {
        const xidUser = await getXidStuff(xid, zid);
        shouldCreateXidRecord = xidUser === 'noXidRecord' || xidUser.pid === -1;
        if (typeof xidUser === 'object' && !shouldCreateXidRecord) {
          uid = xidUser.uid;
          pid = xidUser.pid;
          return pid;
        }
      }
      if (shouldCreateXidRecord) {
        await createXidRecordByZid(zid, uid, xid, null, null, null);
      }
      const newPid = await doGetPid();
      return newPid;
    })();
    const commentExistsPromise = commentExists(zid, txt);
    const [finalPid, conv, is_moderator, commentExistsAlready, spammy, jigsawResponse] = await Promise.all([
      pidPromise,
      conversationInfoPromise,
      isModeratorPromise,
      commentExistsPromise,
      isSpamPromise,
      jigsawModerationPromise
    ]);
    if (!is_moderator && mustBeModerator) {
      fail(res, 403, 'polis_err_post_comment_auth');
      return;
    }
    if (finalPid && finalPid < 0) {
      fail(res, 500, 'polis_err_post_comment_bad_pid');
      return;
    }
    if (commentExistsAlready) {
      fail(res, 409, 'polis_err_post_comment_duplicate');
      return;
    }
    if (!conv.is_active) {
      fail(res, 403, 'polis_err_conversation_is_closed');
      return;
    }
    const bad = hasBadWords(txt);
    const velocity = 1;
    const jigsawToxicityThreshold = 0.8;
    let active = true;
    const classifications = [];
    const toxicityScore = jigsawResponse?.attributeScores?.TOXICITY?.summaryScore?.value;
    if (typeof toxicityScore === 'number' && !Number.isNaN(toxicityScore)) {
      logger.debug(`Jigsaw toxicity Score for comment "${txt}": ${toxicityScore}`);
      if (toxicityScore > jigsawToxicityThreshold && conv.profanity_filter) {
        active = false;
        classifications.push('bad');
        logger.info('active=false because (jigsawToxicity && conv.profanity_filter)');
      }
    } else if (bad && conv.profanity_filter) {
      active = false;
      classifications.push('bad');
      logger.info('active=false because (bad && conv.profanity_filter)');
    }
    if (spammy && conv.spam_filter) {
      active = false;
      classifications.push('spammy');
      logger.info('active=false because (spammy && conv.spam_filter)');
    }
    let mod = 0;
    if (is_moderator && is_seed) {
      mod = polisTypes.mod.ok;
      active = true;
    }
    const [detections] = await Promise.all([detectLanguage(txt)]);
    const detection = Array.isArray(detections) ? detections[0] : detections;
    const lang = detection.language;
    const lang_confidence = detection.confidence;
    const insertedComment = await queryP(
      `INSERT INTO COMMENTS
      (pid, zid, txt, velocity, active, mod, uid, anon, is_seed, created, tid, lang, lang_confidence)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, default, null, $10, $11)
      RETURNING *;`,
      [finalPid, zid, txt, velocity, active, mod, uid, anon || false, is_seed || false, lang, lang_confidence]
    );
    const comment = insertedComment[0];
    const tid = comment.tid;
    if (bad || spammy || conv.strict_moderation) {
      try {
        const n = await getNumberOfCommentsWithModerationStatus(zid, polisTypes.mod.unmoderated);
        if (n !== 0) {
          const users = await queryP_readOnly(
            'SELECT * FROM users WHERE site_id = (SELECT site_id FROM page_ids WHERE zid = $1) UNION SELECT * FROM users WHERE uid = $2;',
            [zid, conv.owner]
          );
          const uids = users.map((user) => user.uid);
          uids.forEach((uid) => sendCommentModerationEmail(req, Number(uid), zid, n));
        }
      } catch (err) {
        logger.error('polis_err_getting_modstatus_comment_count', err);
      }
    } else {
      addNotificationTask(zid);
    }
    if (is_seed && _.isUndefined(vote) && Number(zid) <= 17037) {
      vote = 0;
    }
    let createdTime = comment.created;
    if (!_.isUndefined(vote)) {
      try {
        const voteResult = await votesPost(uid, finalPid, zid, tid, xid, vote, 0, false);
        if (voteResult?.vote?.created) {
          createdTime = voteResult.vote.created;
        }
      } catch (err) {
        fail(res, 500, 'polis_err_vote_on_create', err);
        return;
      }
    }
    setTimeout(() => {
      updateConversationModifiedTime(zid, createdTime);
      updateLastInteractionTimeForConversation(zid, uid);
      if (!_.isUndefined(vote)) {
        updateVoteCount(zid, finalPid);
      }
    }, 100);
    res.json({
      tid: tid,
      currentPid: currentPid
    });
  } catch (err) {
    if (err.code === '23505' || err.code === 23505) {
      fail(res, 409, 'polis_err_post_comment_duplicate', err);
    } else {
      fail(res, 500, 'polis_err_post_comment', err);
    }
  }
}

function handle_GET_comments_translations(req, res) {
  const zid = req.p.zid;
  const tid = req.p.tid;
  const firstTwoCharsOfLang = req.p.lang.substr(0, 2);
  getComment(zid, tid)
    .then((comment) => {
      return queryP("select * from comment_translations where zid = ($1) and tid = ($2) and lang LIKE '$3%';", [
        zid,
        tid,
        firstTwoCharsOfLang
      ])
        .then((existingTranslations) => {
          if (existingTranslations) {
            return existingTranslations;
          }
          return translateAndStoreComment(zid, tid, comment.txt, req.p.lang);
        })
        .then((rows) => {
          res.status(200).json(rows || []);
        });
    })
    .catch((err) => {
      fail(res, 500, 'polis_err_get_comments_translations', err);
    });
}

function handle_GET_comments(req, res) {
  const rid = `${req?.headers?.['x-request-id']} ${req?.headers?.['user-agent']}`;
  logger.debug('getComments begin', { rid });
  getComments(req.p)
    .then((comments) => {
      if (req.p.rid) {
        return queryP('select tid, selection from report_comment_selections where rid = ($1);', [req.p.rid]).then(
          (selections) => {
            const tidToSelection = _.indexBy(selections, 'tid');
            comments = comments.map((c) => {
              c.includeInReport = tidToSelection[c.tid] && tidToSelection[c.tid].selection > 0;
              return c;
            });
            return comments;
          }
        );
      }
      return comments;
    })
    .then((comments) => {
      finishArray(res, comments);
    })
    .catch((err) => {
      fail(res, 500, 'polis_err_get_comments', err);
    });
}

function handle_GET_nextComment(req, res) {
  if (req.timedout) {
    return;
  }
  getNextComment(req.p.zid, req.p.not_voted_by_pid, req.p.without, req.p.include_social, req.p.lang)
    .then(
      (c) => {
        if (req.timedout) {
          return;
        }
        if (c) {
          if (!_.isUndefined(req.p.not_voted_by_pid)) {
            c.currentPid = req.p.not_voted_by_pid;
          }
          finishOne(res, c);
        } else {
          const o = {};
          if (!_.isUndefined(req.p.not_voted_by_pid)) {
            o.currentPid = req.p.not_voted_by_pid;
          }
          res.status(200).json(o);
        }
      },
      (err) => {
        if (req.timedout) {
          return;
        }
        fail(res, 500, 'polis_err_get_next_comment2', err);
      }
    )
    .catch((err) => {
      if (req.timedout) {
        return;
      }
      fail(res, 500, 'polis_err_get_next_comment', err);
    });
}

function handle_POST_ptptCommentMod(req, res) {
  const zid = req.p.zid;
  const pid = req.p.pid;
  const uid = req.p.uid;
  return queryP(
    'insert into crowd_mod (' +
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
      'as_unsure) values (' +
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
      '$13);',
    [
      req.p.zid,
      req.p.pid,
      req.p.tid,
      req.p.as_abusive,
      req.p.as_factual,
      req.p.as_feeling,
      req.p.as_important,
      req.p.as_notfact,
      req.p.as_notgoodidea,
      req.p.as_notmyfeeling,
      req.p.as_offtopic,
      req.p.as_spam,
      req.p.unsure
    ]
  )
    .then((createdTime) => {
      setTimeout(() => {
        updateConversationModifiedTime(req.p.zid, createdTime);
        updateLastInteractionTimeForConversation(zid, uid);
      }, 100);
    })
    .then(() => getNextComment(req.p.zid, pid, [], true, req.p.lang))
    .then((nextComment) => {
      const result = {};
      if (nextComment) {
        result.nextComment = nextComment;
      } else {
        addNoMoreCommentsRecord(req.p.zid, pid);
      }
      result.currentPid = req.p.pid;
      finishOne(res, result);
    })
    .catch((err) => {
      if (err === 'polis_err_ptptCommentMod_duplicate') {
        fail(res, 406, 'polis_err_ptptCommentMod_duplicate', err);
      } else if (err === 'polis_err_conversation_is_closed') {
        fail(res, 403, 'polis_err_conversation_is_closed', err);
      } else {
        fail(res, 500, 'polis_err_ptptCommentMod', err);
      }
    });
}

function handle_PUT_comments(req, res) {
  const uid = req.p.uid;
  const zid = req.p.zid;
  const tid = req.p.tid;
  const active = req.p.active;
  const mod = req.p.mod;
  const is_meta = req.p.is_meta;
  logger.debug(`Attempting to update comment. zid: ${zid}, tid: ${tid}, uid: ${uid}`);
  isModerator(zid, uid)
    .then((isModerator) => {
      logger.debug(`isModerator result: ${isModerator}`);
      if (isModerator) {
        moderateComment(zid, tid, active, mod, is_meta).then(
          () => {
            logger.debug('Comment moderated successfully');
            res.status(200).json({});
          },
          (err) => {
            logger.error('Error in moderateComment:', err);
            fail(res, 500, 'polis_err_update_comment', err);
          }
        );
      } else {
        logger.debug('User is not a moderator');
        fail(res, 403, 'polis_err_update_comment_auth');
      }
    })
    .catch((err) => {
      logger.error('Error in isModerator:', err);
      fail(res, 500, 'polis_err_update_comment', err);
    });
}

function handle_POST_reportCommentSelections(req, res) {
  const uid = req.p.uid;
  const zid = req.p.zid;
  const rid = req.p.rid;
  const tid = req.p.tid;
  const selection = req.p.include ? 1 : -1;
  isModerator(zid, uid)
    .then((isMod) => {
      if (!isMod) {
        return fail(res, 403, 'polis_err_POST_reportCommentSelections_auth');
      }
      return queryP(
        'insert into report_comment_selections (rid, tid, selection, zid, modified) values ($1, $2, $3, $4, now_as_millis()) ' +
          'on conflict (rid, tid) do update set selection = ($3), zid  = ($4), modified = now_as_millis();',
        [rid, tid, selection, zid]
      )
        .then(() => {
          return queryP('delete from math_report_correlationmatrix where rid = ($1);', [rid]);
        })
        .then(() => {
          res.json({});
        });
    })
    .catch((err) => {
      fail(res, 500, 'polis_err_POST_reportCommentSelections_misc', err);
    });
}

export {
  addNoMoreCommentsRecord,
  createModerationUrl,
  getNextComment,
  handle_GET_comments_translations,
  handle_GET_comments,
  handle_GET_nextComment,
  handle_POST_comments,
  handle_POST_ptptCommentMod,
  handle_POST_reportCommentSelections,
  handle_PUT_comments
};
