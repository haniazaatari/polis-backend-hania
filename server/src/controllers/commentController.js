import _ from 'underscore';
import Config from '../config.js';
import { isModerator } from '../db/authorization.js';
import { getNumberOfCommentsWithModerationStatus } from '../db/comments.js';
import { getComments } from '../db/comments.js';
import { addNoMoreCommentsRecord } from '../db/comments.js';
import {
  updateConversationModifiedTime,
  updateLastInteractionTimeForConversation,
  updateVoteCount
} from '../db/conversationUpdates.js';
import { getConversationInfo } from '../db/conversations.js';
import { getPidPromise } from '../db/getPidPromise.js';
import { createNotificationTask } from '../db/notifications.js';
import { addParticipant } from '../db/participants.js';
import { pgQueryP, pgQueryP_readOnly } from '../db/pg-query.js';
import { votesPost } from '../db/votes.js';
import { getXidStuff } from '../db/xid.js';
import { sendCommentModerationEmail } from '../email/commentModeration.js';
import { getDemographicsForVotersOnComments } from '../repositories/demographics/demographicsRepository.js';
import { getComment, getNextComment, translateAndStoreComment } from '../services/comment/commentService.js';
import { detectLanguage } from '../services/translation/translationService.js';
import { createXidRecordByZid } from '../services/xid/xidService.js';
import { analyzeComment, commentExists, hasBadWords, isSpam } from '../utils/commentUtils.js';
import logger from '../utils/logger.js';
import polisTypes from '../utils/polisTypes.js';
import { fail, finishArray, finishOne } from '../utils/responseHandlers.js';

/**
 * Handle POST request to create a new comment
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handlePostComments(req, res) {
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
    const insertedComment = await pgQueryP(
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
          const users = await pgQueryP_readOnly(
            'SELECT * FROM users WHERE site_id = (SELECT site_id FROM page_ids WHERE zid = $1) UNION SELECT * FROM users WHERE uid = $2;',
            [zid, conv.owner]
          );
          const uids = users.map((user) => user.uid);
          for (const uid of uids) {
            sendCommentModerationEmail(req, Number(uid), zid, n);
          }
        }
      } catch (err) {
        logger.error('polis_err_getting_modstatus_comment_count', err);
      }
    } else {
      createNotificationTask(zid);
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
        if (err === 'polis_err_param_pid_invalid' || err === 'polis_err_param_tid_invalid') {
          logger.error('Vote on comment create failed with invalid parameters', {
            error: err,
            uid,
            pid: finalPid,
            zid,
            tid
          });
        } else {
          logger.error('Error creating vote on comment', {
            error: err,
            uid,
            pid: finalPid,
            zid,
            tid,
            vote
          });
        }
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

/**
 * Handle GET request to retrieve comments
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
function handleGetComments(req, res) {
  const rid = `${req?.headers?.['x-request-id']} ${req?.headers?.['user-agent']}`;
  logger.debug('getComments begin', { rid });
  const isReportQuery = !_.isUndefined(req.p.rid);
  getComments(req.p)
    .then((comments) => {
      if (req.p.rid) {
        return pgQueryP_readOnly('select tid, selection from report_comment_selections where rid = ($1);', [
          req.p.rid
        ]).then((selections) => {
          const tidToSelection = _.indexBy(selections, 'tid');
          const commentsWithReportStatus = comments.map((c) => {
            return {
              ...c,
              includeInReport: tidToSelection[c.tid] && tidToSelection[c.tid].selection > 0
            };
          });
          return commentsWithReportStatus;
        });
      }

      return comments;
    })
    .then((comments) => {
      const commentsWithSocialInfo = comments.map((c) => {
        const newC = { ...c };
        return newC;
      });
      if (req.p.include_demographics) {
        isModerator(req.p.zid, req.p.uid)
          .then((owner) => {
            if (owner || isReportQuery) {
              return getDemographicsForVotersOnComments(req.p.zid, commentsWithSocialInfo)
                .then((commentsWithDemographics) => {
                  finishArray(res, commentsWithDemographics);
                })
                .catch((err) => {
                  fail(res, 500, 'polis_err_get_comments3', err);
                });
            }

            fail(res, 500, 'polis_err_get_comments_permissions');
          })
          .catch((err) => {
            fail(res, 500, 'polis_err_get_comments2', err);
          });
      } else {
        finishArray(res, commentsWithSocialInfo);
      }
    })
    .catch((err) => {
      fail(res, 500, 'polis_err_get_comments', err);
    });
}

/**
 * Handle comment moderation
 * @param {number} zid - Conversation ID
 * @param {number} tid - Comment ID
 * @param {boolean} active - Whether the comment is active
 * @param {number} mod - Moderation status
 * @param {boolean} is_meta - Whether the comment is meta
 * @returns {Promise<Object>} - Result of the moderation
 */
function moderateComment(zid, tid, active, mod, is_meta) {
  return new Promise((resolve, reject) => {
    const query = 'UPDATE comments SET active = $1, mod = $2, is_meta = $3 WHERE zid = $4 AND tid = $5';
    const params = [active, mod, is_meta, zid, tid];
    logger.debug('Executing query:', { query });
    logger.debug('With parameters:', { params });
    pgQueryP(query, params)
      .then((result) => {
        logger.debug('moderateComment executed successfully');
        resolve(result);
      })
      .catch((err) => {
        logger.error('moderateComment error:', err);
        reject(err);
      });
  });
}

/**
 * Handle GET request to retrieve comment translations
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleGetCommentsTranslations(req, res) {
  try {
    const zid = req.p.zid;
    const tid = req.p.tid;

    // If no language is specified, return empty array
    if (!req.p.lang) {
      logger.warn(`Translation requested without specifying language: zid=${zid}, tid=${tid}`);
      res.status(200).json([]);
      return;
    }

    const firstTwoCharsOfLang = req.p.lang.substr(0, 2);

    const comment = await getComment(zid, tid);

    // If comment doesn't exist, return empty array
    if (!comment) {
      logger.warn(`Translation requested for non-existent comment: zid=${zid}, tid=${tid}`);
      res.status(200).json([]);
      return;
    }

    // Check for existing translations
    const existingTranslations = await pgQueryP_readOnly(
      "SELECT * FROM comment_translations WHERE zid = ($1) AND tid = ($2) AND lang LIKE ($3 || '%');",
      [zid, tid, firstTwoCharsOfLang]
    );

    // If translations exist, return them
    if (existingTranslations?.length) {
      res.status(200).json(existingTranslations);
      return;
    }

    // Otherwise, translate and store the comment
    const translations = await translateAndStoreComment(zid, tid, comment.txt, req.p.lang);
    res.status(200).json(translations || []);
  } catch (err) {
    fail(res, 500, 'polis_err_get_comments_translations', err);
  }
}

/**
 * Handle GET request to retrieve the next comment
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleGetNextComment(req, res) {
  if (req.timedout) {
    return;
  }

  try {
    const comment = await getNextComment(
      req.p.zid,
      req.p.not_voted_by_pid,
      req.p.without,
      req.p.include_social,
      req.p.lang
    );

    if (req.timedout) {
      return;
    }

    if (comment) {
      if (!_.isUndefined(req.p.not_voted_by_pid)) {
        comment.currentPid = req.p.not_voted_by_pid;
      }
      finishOne(res, comment);
    } else {
      const response = {};
      if (!_.isUndefined(req.p.not_voted_by_pid)) {
        response.currentPid = req.p.not_voted_by_pid;
      }
      res.status(200).json(response);
    }
  } catch (err) {
    if (req.timedout) {
      return;
    }
    fail(res, 500, 'polis_err_get_next_comment', err);
  }
}

/**
 * Handle POST request for participant comment moderation
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handlePostPtptCommentMod(req, res) {
  try {
    const zid = req.p.zid;
    const pid = req.p.pid;
    const uid = req.p.uid;

    // Insert crowd moderation record
    const createdTime = await pgQueryP(
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
    );

    // Update conversation modified time
    setTimeout(() => {
      updateConversationModifiedTime(req.p.zid, createdTime);
      updateLastInteractionTimeForConversation(zid, uid);
    }, 100);

    // Get next comment
    const nextComment = await getNextComment(req.p.zid, pid, [], true, req.p.lang);

    // Prepare result
    const result = {};
    if (nextComment) {
      result.nextComment = nextComment;
    } else {
      await addNoMoreCommentsRecord(req.p.zid, pid);
    }

    result.currentPid = req.p.pid;
    finishOne(res, result);
  } catch (err) {
    if (err === 'polis_err_ptptCommentMod_duplicate') {
      fail(res, 406, 'polis_err_ptptCommentMod_duplicate', err);
    } else if (err === 'polis_err_conversation_is_closed') {
      fail(res, 403, 'polis_err_conversation_is_closed', err);
    } else {
      fail(res, 500, 'polis_err_ptptCommentMod', err);
    }
  }
}

/**
 * Handle PUT request to update a comment
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handlePutComments(req, res) {
  try {
    const uid = req.p.uid;
    const zid = req.p.zid;
    const tid = req.p.tid;
    const active = req.p.active;
    const mod = req.p.mod;
    const is_meta = req.p.is_meta;

    logger.debug(`Attempting to update comment. zid: ${zid}, tid: ${tid}, uid: ${uid}`);

    const isMod = await isModerator(zid, uid);
    logger.debug(`isModerator result: ${isMod}`);

    if (isMod) {
      await moderateComment(zid, tid, active, mod, is_meta);
      logger.debug('Comment moderated successfully');
      res.status(200).json({});
    } else {
      logger.debug('User is not a moderator');
      fail(res, 403, 'polis_err_update_comment_auth');
    }
  } catch (err) {
    logger.error('Error in handlePutComments:', err);
    fail(res, 500, 'polis_err_update_comment', err);
  }
}

export {
  handlePostComments,
  handleGetComments,
  handleGetCommentsTranslations,
  handleGetNextComment,
  handlePostPtptCommentMod,
  handlePutComments,
  moderateComment
};
