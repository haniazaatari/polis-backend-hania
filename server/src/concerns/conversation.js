import _ from 'underscore';
import { generateAndRegisterZinvite } from '../auth/create-user.js';
import { generateToken } from '../auth/password.js';
import Config from '../config.js';
import { getConversationInfo, getZidFromConversationId } from '../conversation.js';
import { query as pgQuery, queryP, queryP_readOnly, query_readOnly } from '../db/pg-query.js';
import { sql_conversations } from '../db/sql.js';
import { getUserInfoForUid2 } from '../user.js';
import { ifDefinedFirstElseSecond, ifDefinedSet, isDuplicateKey, isModerator, isPolisDev } from '../utils/common.js';
import { DEFAULTS } from '../utils/constants.js';
import { setParentReferrerCookie, setParentUrlCookie } from '../utils/cookies.js';
import { fail } from '../utils/fail.js';
import logger from '../utils/logger.js';
import { getZinvite } from '../utils/zinvite.js';
import { createModerationUrl } from './comment.js';
import { createOneSuzinvite, sendEmailByUid, sendImplicitConversationCreatedEmails } from './email.js';
import { addConversationIds, finishOne } from './response.js';
import { fetchIndex, makeFileFetcher } from './static.js';

const serverUrl = Config.getServerUrl();
const hostname = Config.staticFilesHost;

function updateConversationModifiedTime(zid, t) {
  const modified = _.isUndefined(t) ? Date.now() : Number(t);
  let query = 'update conversations set modified = ($2) where zid = ($1) and modified < ($2);';
  let params = [zid, modified];
  if (_.isUndefined(t)) {
    query = 'update conversations set modified = now_as_millis() where zid = ($1);';
    params = [zid];
  }
  return queryP(query, params);
}

function updateLastInteractionTimeForConversation(zid, uid) {
  return queryP(
    'update participants set last_interaction = now_as_millis(), nsli = 0 where zid = ($1) and uid = ($2);',
    [zid, uid]
  );
}

function updateVoteCount(zid, pid) {
  return queryP(
    'update participants set vote_count = (select count(*) from votes where zid = ($1) and pid = ($2)) where zid = ($1) and pid = ($2)',
    [zid, pid]
  );
}

function doGetConversationsRecent(req, res, field) {
  if (!isPolisDev(req.p.uid)) {
    fail(res, 403, 'polis_err_no_access_for_this_user');
    return;
  }
  let time = req.p.sinceUnixTimestamp;
  if (_.isUndefined(time)) {
    time = Date.now() - 1000 * 60 * 60 * 24 * 7;
  } else {
    time *= 1000;
  }
  time = Number.parseInt(time);
  queryP_readOnly(`select * from conversations where ${field} >= ($1);`, [time])
    .then((rows) => {
      res.json(rows);
    })
    .catch((err) => {
      fail(res, 403, 'polis_err_conversationsRecent', err);
    });
}

function getFirstForPid(votes) {
  const seen = {};
  const len = votes.length;
  const firstVotes = [];
  for (let i = 0; i < len; i++) {
    const vote = votes[i];
    if (!seen[vote.pid]) {
      firstVotes.push(vote);
      seen[vote.pid] = true;
    }
  }
  return firstVotes;
}

function verifyMetadataAnswersExistForEachQuestion(zid) {
  const errorcode = 'polis_err_missing_metadata_answers';
  return new Promise((resolve, reject) => {
    query_readOnly('select pmqid from participant_metadata_questions where zid = ($1);', [zid], (err, results) => {
      if (err) {
        reject(err);
        return;
      }
      if (!results.rows || !results.rows.length) {
        resolve();
        return;
      }
      const pmqids = results.rows.map((row) => Number(row.pmqid));
      query_readOnly(
        `select pmaid, pmqid from participant_metadata_answers where pmqid in (${pmqids.join(',')}) and alive = TRUE and zid = ($1);`,
        [zid],
        (err, results) => {
          if (err) {
            reject(err);
            return;
          }
          if (!results.rows || !results.rows.length) {
            reject(new Error(errorcode));
            return;
          }
          const questions = _.reduce(
            pmqids,
            (o, pmqid) => {
              o[pmqid] = 1;
              return o;
            },
            {}
          );
          results.rows.forEach((row) => {
            delete questions[row.pmqid];
          });
          if (Object.keys(questions).length) {
            reject(new Error(errorcode));
          } else {
            resolve();
          }
        }
      );
    });
  });
}

function generateAndReplaceZinvite(zid, generateShortZinvite) {
  let len = 12;
  if (generateShortZinvite) {
    len = 6;
  }
  return new Promise((resolve, reject) => {
    generateToken(len, false, (err, zinvite) => {
      if (err) {
        return reject('polis_err_creating_zinvite');
      }
      pgQuery('update zinvites set zinvite = ($1) where zid = ($2);', [zinvite, zid], (err, _results) => {
        if (err) {
          reject(err);
        } else {
          resolve(zinvite);
        }
      });
    });
  });
}

function getConversationHasMetadata(zid) {
  return new Promise((resolve, reject) => {
    query_readOnly('SELECT * from participant_metadata_questions where zid = ($1)', [zid], (err, metadataResults) => {
      if (err) {
        return reject('polis_err_get_conversation_metadata_by_zid');
      }
      const hasNoMetadata = !metadataResults || !metadataResults.rows || !metadataResults.rows.length;
      resolve(!hasNoMetadata);
    });
  });
}

function getConversationTranslations(zid, lang) {
  const firstTwoCharsOfLang = lang.substr(0, 2);
  return queryP('select * from conversation_translations where zid = ($1) and lang = ($2);', [
    zid,
    firstTwoCharsOfLang
  ]);
}

function getConversationTranslationsMinimal(zid, lang) {
  if (!lang) {
    return Promise.resolve([]);
  }
  return getConversationTranslations(zid, lang).then((rows) => {
    for (let i = 0; i < rows.length; i++) {
      rows[i].zid = undefined;
      rows[i].created = undefined;
      rows[i].modified = undefined;
      rows[i].src = undefined;
    }
    return rows;
  });
}

function getOneConversation(zid, uid, lang) {
  return Promise.all([
    queryP_readOnly(
      'select * from conversations left join  (select uid, site_id from users) as u on conversations.owner = u.uid where conversations.zid = ($1);',
      [zid]
    ),
    getConversationHasMetadata(zid),
    _.isUndefined(uid) ? Promise.resolve({}) : getUserInfoForUid2(uid),
    getConversationTranslationsMinimal(zid, lang)
  ]).then((results) => {
    const conv = results[0]?.[0];
    const convHasMetadata = results[1];
    const requestingUserInfo = results[2];
    const translations = results[3];
    conv.auth_opt_allow_3rdparty = ifDefinedFirstElseSecond(conv.auth_opt_allow_3rdparty, true);
    conv.translations = translations;
    return getUserInfoForUid2(conv.owner).then((ownerInfo) => {
      const ownername = ownerInfo.hname;
      if (convHasMetadata) {
        conv.hasMetadata = true;
      }
      if (!_.isUndefined(ownername) && conv.context !== 'hongkong2014') {
        conv.ownername = ownername;
      }
      conv.is_mod = conv.site_id === requestingUserInfo.site_id;
      conv.is_owner = conv.owner === uid;
      conv.uid = undefined;
      return conv;
    });
  });
}

function getConversations(req, res) {
  const uid = req.p.uid;
  const zid = req.p.zid;
  const xid = req.p.xid;
  const include_all_conversations_i_am_in = req.p.include_all_conversations_i_am_in;
  const want_mod_url = req.p.want_mod_url;
  const want_upvoted = req.p.want_upvoted;
  const want_inbox_item_admin_url = req.p.want_inbox_item_admin_url;
  const want_inbox_item_participant_url = req.p.want_inbox_item_participant_url;
  const want_inbox_item_admin_html = req.p.want_inbox_item_admin_html;
  const want_inbox_item_participant_html = req.p.want_inbox_item_participant_html;
  const _context = req.p.context;
  let zidListQuery =
    'select zid, 1 as type from conversations where owner in (select uid from users where site_id = (select site_id from users where uid = ($1)))';
  if (include_all_conversations_i_am_in) {
    zidListQuery += ' UNION ALL select zid, 2 as type from participants where uid = ($1)';
  }
  zidListQuery += ';';
  query_readOnly(zidListQuery, [uid], (err, results) => {
    if (err) {
      fail(res, 500, 'polis_err_get_conversations_participated_in', err);
      return;
    }
    const participantInOrSiteAdminOf = (results?.rows && _.pluck(results.rows, 'zid')) || null;
    const siteAdminOf = _.filter(results.rows, (row) => row.type === 1);
    const isSiteAdmin = _.indexBy(siteAdminOf, 'zid');
    let query = sql_conversations.select(sql_conversations.star());
    let isRootsQuery = false;
    let orClauses;
    if (!_.isUndefined(req.p.context)) {
      if (req.p.context === '/') {
        orClauses = sql_conversations.is_public.equals(true);
        isRootsQuery = true;
      } else {
        orClauses = sql_conversations.context.equals(req.p.context);
      }
    } else {
      orClauses = sql_conversations.owner.equals(uid);
      if (participantInOrSiteAdminOf.length) {
        orClauses = orClauses.or(sql_conversations.zid.in(participantInOrSiteAdminOf));
      }
    }
    query = query.where(orClauses);
    if (!_.isUndefined(req.p.course_invite)) {
      query = query.and(sql_conversations.course_id.equals(req.p.course_id));
    }
    if (!_.isUndefined(req.p.is_active)) {
      query = query.and(sql_conversations.is_active.equals(req.p.is_active));
    }
    if (!_.isUndefined(req.p.is_draft)) {
      query = query.and(sql_conversations.is_draft.equals(req.p.is_draft));
    }
    if (!_.isUndefined(req.p.zid)) {
      query = query.and(sql_conversations.zid.equals(zid));
    }
    if (isRootsQuery) {
      query = query.and(sql_conversations.context.isNotNull());
    }
    query = query.order(sql_conversations.created.descending);
    if (!_.isUndefined(req.p.limit)) {
      query = query.limit(req.p.limit);
    } else {
      query = query.limit(999);
    }
    query_readOnly(query.toString(), (err, result) => {
      if (err) {
        fail(res, 500, 'polis_err_get_conversations', err);
        return;
      }
      const data = result.rows || [];
      addConversationIds(data)
        .then((data) => {
          let suurlsPromise;
          if (xid) {
            suurlsPromise = Promise.all(
              data.map((conv) => createOneSuzinvite(xid, conv.zid, conv.owner, _.partial(generateSingleUseUrl, req)))
            );
          } else {
            suurlsPromise = Promise.resolve();
          }
          const upvotesPromise =
            uid && want_upvoted
              ? queryP_readOnly('select zid from upvotes where uid = ($1);', [uid])
              : Promise.resolve();
          return Promise.all([suurlsPromise, upvotesPromise]).then(
            (x) => {
              let suurlData = x[0];
              let upvotes = x[1];
              if (suurlData) {
                suurlData = _.indexBy(suurlData, 'zid');
              }
              if (upvotes) {
                upvotes = _.indexBy(upvotes, 'zid');
              }
              data.forEach((conv) => {
                conv.is_owner = conv.owner === uid;
                if (want_mod_url) {
                  conv.mod_url = createModerationUrl(conv.conversation_id);
                }
                if (want_inbox_item_admin_url) {
                  conv.inbox_item_admin_url = `${serverUrl}/iim/${conv.conversation_id}`;
                }
                if (want_inbox_item_participant_url) {
                  conv.inbox_item_participant_url = `${serverUrl}/iip/${conv.conversation_id}`;
                }
                if (want_inbox_item_admin_html) {
                  conv.inbox_item_admin_html = `<a href='${serverUrl}/${conv.conversation_id}'>${conv.topic || conv.created}</a> <a href='${serverUrl}/m/${conv.conversation_id}'>moderate</a>`;
                  conv.inbox_item_admin_html_escaped = conv.inbox_item_admin_html.replace(/'/g, "\\'");
                }
                if (want_inbox_item_participant_html) {
                  conv.inbox_item_participant_html = `<a href='${serverUrl}/${conv.conversation_id}'>${conv.topic || conv.created}</a>`;
                  conv.inbox_item_participant_html_escaped = conv.inbox_item_admin_html.replace(/'/g, "\\'");
                }
                if (suurlData) {
                  conv.url = suurlData[conv.zid || ''].suurl;
                } else {
                  conv.url = buildConversationUrl(req, conv.conversation_id);
                }
                if (upvotes?.[conv.zid || '']) {
                  conv.upvoted = true;
                }
                conv.created = Number(conv.created);
                conv.modified = Number(conv.modified);
                if (_.isUndefined(conv.topic) || conv.topic === '') {
                  conv.topic = new Date(conv.created).toUTCString();
                }
                conv.is_mod = conv.is_owner || isSiteAdmin[conv.zid || ''];
                conv.zid = undefined;
                conv.is_anon = undefined;
                conv.is_draft = undefined;
                conv.is_public = undefined;
                if (conv.context === '') {
                  conv.context = undefined;
                }
              });
              res.status(200).json(data);
            },
            (err) => {
              fail(res, 500, 'polis_err_get_conversations_surls', err);
            }
          );
        })
        .catch((err) => {
          fail(res, 500, 'polis_err_get_conversations_misc', err);
        });
    });
  });
}

function registerPageId(site_id, page_id, zid) {
  return queryP('insert into page_ids (site_id, page_id, zid) values ($1, $2, $3);', [site_id, page_id, zid]);
}

function generateSingleUseUrl(_req, conversation_id, suzinvite) {
  return `${serverUrl}/ot/${conversation_id}/${suzinvite}`;
}

function buildConversationUrl(_req, zinvite) {
  return `${serverUrl}/${zinvite}`;
}

function buildConversationDemoUrl(_req, zinvite) {
  return `${serverUrl}/demo/${zinvite}`;
}

function buildModerationUrl(_req, zinvite) {
  return `${serverUrl}/m/${zinvite}`;
}

function buildSeedUrl(req, zinvite) {
  return `${buildModerationUrl(req, zinvite)}/comments/seed`;
}

function getConversationUrl(req, zid, dontUseCache) {
  return getZinvite(zid, dontUseCache).then((zinvite) => buildConversationUrl(req, zinvite));
}

function initializeImplicitConversation(site_id, page_id, o) {
  return queryP_readOnly('select uid from users where site_id = ($1) and site_owner = TRUE;', [site_id]).then(
    (rows) => {
      if (!rows || !rows.length) {
        throw new Error('polis_err_bad_site_id');
      }
      return new Promise((resolve, reject) => {
        const uid = rows[0].uid;
        const generateShortUrl = false;
        isUserAllowedToCreateConversations(uid, (err, isAllowed) => {
          if (err) {
            reject(err);
            return;
          }
          if (!isAllowed) {
            reject(err);
            return;
          }
          const params = Object.assign(o, {
            owner: uid,
            org_id: uid,
            is_active: true,
            is_draft: false,
            is_public: true,
            is_anon: false,
            profanity_filter: true,
            spam_filter: true,
            strict_moderation: false,
            owner_sees_participation_stats: false
          });
          const q = sql_conversations.insert(params).returning('*').toString();
          pgQuery(q, [], (err, result) => {
            if (err) {
              if (isDuplicateKey(err)) {
                logger.error('polis_err_create_implicit_conv_duplicate_key', err);
                reject('polis_err_create_implicit_conv_duplicate_key');
              } else {
                reject('polis_err_create_implicit_conv_db');
              }
            }
            const zid = result?.rows?.[0]?.zid;
            Promise.all([registerPageId(site_id, page_id, zid), generateAndRegisterZinvite(zid, generateShortUrl)])
              .then((o) => {
                const zinvite = o[1];
                resolve({
                  owner: uid,
                  zid: zid,
                  zinvite: zinvite
                });
              })
              .catch((err) => {
                reject('polis_err_zinvite_create_implicit', err);
              });
          });
        });
      });
    }
  );
}

function isUserAllowedToCreateConversations(_uid, callback) {
  callback?.(null, true);
}

function subscribeToNotifications(zid, uid, email) {
  const type = 1;
  logger.info('subscribeToNotifications', { zid, uid });
  return queryP('update participants_extended set subscribe_email = ($3) where zid = ($1) and uid = ($2);', [
    zid,
    uid,
    email
  ]).then(() =>
    queryP('update participants set subscribed = ($3) where zid = ($1) and uid = ($2);', [zid, uid, type]).then(
      (_rows) => type
    )
  );
}

function unsubscribeFromNotifications(zid, uid) {
  const type = 0;
  return queryP('update participants set subscribed = ($3) where zid = ($1) and uid = ($2);', [zid, uid, type]).then(
    (_rows) => type
  );
}

function failWithRetryRequest(res) {
  res.setHeader('Retry-After', 0);
  logger.warn('failWithRetryRequest');
  res.writeHead(500).send(57493875);
}

function fetchIndexForConversation(req, res) {
  logger.debug('fetchIndexForConversation', req.path);
  const match = req.path.match(/[0-9][0-9A-Za-z]+/);
  let conversation_id;
  if (match?.length) {
    conversation_id = match[0];
  }
  doGetConversationPreloadInfo(conversation_id)
    .then((x) => {
      const preloadData = {
        conversation: x
      };
      fetchIndex(req, res, preloadData, Config.staticFilesParticipationPort);
    })
    .catch((err) => {
      logger.error('polis_err_fetching_conversation_info', err);
      fetch404Page(req, res);
    });
}

function doGetConversationPreloadInfo(conversation_id) {
  return getZidFromConversationId(conversation_id)
    .then((zid) => Promise.all([getConversationInfo(zid)]))
    .then((a) => {
      let conv = a[0];
      const auth_opt_allow_3rdparty = ifDefinedFirstElseSecond(
        conv.auth_opt_allow_3rdparty,
        DEFAULTS.auth_opt_allow_3rdparty
      );
      conv = {
        topic: conv.topic,
        description: conv.description,
        created: conv.created,
        link_url: conv.link_url,
        parent_url: conv.parent_url,
        vis_type: conv.vis_type,
        write_type: conv.write_type,
        importance_enabled: conv.importance_enabled,
        help_type: conv.help_type,
        socialbtn_type: conv.socialbtn_type,
        bgcolor: conv.bgcolor,
        help_color: conv.help_color,
        help_bgcolor: conv.help_bgcolor,
        style_btn: conv.style_btn,
        auth_needed_to_vote: false,
        auth_needed_to_write: false,
        auth_opt_allow_3rdparty: auth_opt_allow_3rdparty
      };
      conv.conversation_id = conversation_id;
      return conv;
    });
}

const fetch404Page = makeFileFetcher(hostname, Config.staticFilesAdminPort, '/404.html', {
  'Content-Type': 'text/html'
});

function handle_GET_conversationsRecentlyStarted(req, res) {
  doGetConversationsRecent(req, res, 'created');
}

function handle_GET_conversationsRecentActivity(req, res) {
  doGetConversationsRecent(req, res, 'modified');
}

function handle_POST_convSubscriptions(req, res) {
  const zid = req.p.zid;
  const uid = req.p.uid;
  const type = req.p.type;
  const email = req.p.email;
  function finish(type) {
    res.status(200).json({
      subscribed: type
    });
  }
  if (type === 1) {
    subscribeToNotifications(zid, uid, email)
      .then(finish)
      .catch((err) => {
        fail(res, 500, `polis_err_sub_conv ${zid} ${uid}`, err);
      });
  } else if (type === 0) {
    unsubscribeFromNotifications(zid, uid)
      .then(finish)
      .catch((err) => {
        fail(res, 500, `polis_err_unsub_conv ${zid} ${uid}`, err);
      });
  } else {
    fail(res, 400, 'polis_err_bad_subscription_type', new Error('polis_err_bad_subscription_type'));
  }
}

function handle_GET_conversationStats(req, res) {
  const zid = req.p.zid;
  const uid = req.p.uid;
  const until = req.p.until;
  const hasPermission = req.p.rid ? Promise.resolve(!!req.p.rid) : isModerator(zid, uid);
  hasPermission
    .then((ok) => {
      if (!ok) {
        fail(res, 403, 'polis_err_conversationStats_need_report_id_or_moderation_permission');
        return;
      }
      const args = [zid];
      const q0 = until
        ? 'select created, pid, mod from comments where zid = ($1) and created < ($2) order by created;'
        : 'select created, pid, mod from comments where zid = ($1) order by created;';
      const q1 = until
        ? 'select created, pid from votes where zid = ($1) and created < ($2) order by created;'
        : 'select created, pid from votes where zid = ($1) order by created;';
      if (until) {
        args.push(until);
      }
      return Promise.all([queryP_readOnly(q0, args), queryP_readOnly(q1, args)]).then((a) => {
        function castTimestamp(o) {
          o.created = Number(o.created);
          return o;
        }
        const comments = _.map(a[0], castTimestamp);
        const votes = _.map(a[1], castTimestamp);
        const votesGroupedByPid = _.groupBy(votes, 'pid');
        const votesHistogramObj = {};
        _.each(votesGroupedByPid, (votesByParticipant, _pid) => {
          votesHistogramObj[votesByParticipant.length] = votesHistogramObj[votesByParticipant.length] + 1 || 1;
        });
        let votesHistogram = [];
        _.each(votesHistogramObj, (ptptCount, voteCount) => {
          votesHistogram.push({
            n_votes: voteCount,
            n_ptpts: ptptCount
          });
        });
        votesHistogram.sort((a, b) => a.n_ptpts - b.n_ptpts);
        const burstsForPid = {};
        const interBurstGap = 10 * 60 * 1000;
        _.each(votesGroupedByPid, (votesByParticipant, pid) => {
          burstsForPid[pid] = 1;
          let prevCreated = votesByParticipant.length ? votesByParticipant[0] : 0;
          for (let v = 1; v < votesByParticipant.length; v++) {
            const vote = votesByParticipant[v];
            if (interBurstGap + prevCreated < vote.created) {
              burstsForPid[pid] += 1;
            }
            prevCreated = vote.created;
          }
        });
        const burstHistogramObj = {};
        _.each(burstsForPid, (bursts, _pid) => {
          burstHistogramObj[bursts] = burstHistogramObj[bursts] + 1 || 1;
        });
        const burstHistogram = [];
        _.each(burstHistogramObj, (ptptCount, burstCount) => {
          burstHistogram.push({
            n_ptpts: ptptCount,
            n_bursts: Number(burstCount)
          });
        });
        burstHistogram.sort((a, b) => a.n_bursts - b.n_bursts);
        let actualParticipants = getFirstForPid(votes);
        actualParticipants = _.pluck(actualParticipants, 'created');
        let commenters = getFirstForPid(comments);
        commenters = _.pluck(commenters, 'created');
        const totalComments = _.pluck(comments, 'created');
        const totalVotes = _.pluck(votes, 'created');
        votesHistogram = _.map(votesHistogram, (x) => ({
          n_votes: Number(x.n_votes),
          n_ptpts: Number(x.n_ptpts)
        }));
        res.status(200).json({
          voteTimes: totalVotes,
          firstVoteTimes: actualParticipants,
          commentTimes: totalComments,
          firstCommentTimes: commenters,
          votesHistogram: votesHistogram,
          burstHistogram: burstHistogram
        });
      });
    })
    .catch((err) => {
      fail(res, 500, 'polis_err_conversationStats_misc', err);
    });
}

function handle_POST_conversation_close(req, res) {
  let q = 'select * from conversations where zid = ($1)';
  const params = [req.p.zid];
  if (!isPolisDev(req.p.uid)) {
    q = `${q} and owner = ($2)`;
    params.push(req.p.uid);
  }
  queryP(q, params)
    .then((rows) => {
      if (!rows || !rows.length) {
        fail(res, 500, 'polis_err_closing_conversation_no_such_conversation');
        return;
      }
      const conv = rows[0];
      queryP('update conversations set is_active = false where zid = ($1);', [conv.zid]);
    })
    .catch((err) => {
      fail(res, 500, 'polis_err_closing_conversation', err);
    });
}

function handle_POST_conversation_reopen(req, res) {
  let q = 'select * from conversations where zid = ($1)';
  const params = [req.p.zid];
  if (!isPolisDev(req.p.uid)) {
    q = `${q} and owner = ($2)`;
    params.push(req.p.uid);
  }
  queryP(q, params)
    .then((rows) => {
      if (!rows || !rows.length) {
        fail(res, 500, 'polis_err_closing_conversation_no_such_conversation');
        return;
      }
      const conv = rows[0];
      queryP('update conversations set is_active = true where zid = ($1);', [conv.zid])
        .then(() => {
          res.status(200).json({});
        })
        .catch((err) => {
          fail(res, 500, 'polis_err_reopening_conversation2', err);
        });
    })
    .catch((err) => {
      fail(res, 500, 'polis_err_reopening_conversation', err);
    });
}

function handle_PUT_conversations(req, res) {
  const generateShortUrl = req.p.short_url;
  isModerator(req.p.zid, req.p.uid)
    .then((ok) => {
      if (!ok) {
        fail(res, 403, 'polis_err_update_conversation_permission');
        return;
      }
      let verifyMetaPromise;
      if (req.p.verifyMeta) {
        verifyMetaPromise = verifyMetadataAnswersExistForEachQuestion(req.p.zid);
      } else {
        verifyMetaPromise = Promise.resolve();
      }
      const fields = {};
      if (!_.isUndefined(req.p.is_active)) {
        fields.is_active = req.p.is_active;
      }
      if (!_.isUndefined(req.p.is_anon)) {
        fields.is_anon = req.p.is_anon;
      }
      if (!_.isUndefined(req.p.is_draft)) {
        fields.is_draft = req.p.is_draft;
      }
      if (!_.isUndefined(req.p.is_data_open)) {
        fields.is_data_open = req.p.is_data_open;
      }
      if (!_.isUndefined(req.p.profanity_filter)) {
        fields.profanity_filter = req.p.profanity_filter;
      }
      if (!_.isUndefined(req.p.spam_filter)) {
        fields.spam_filter = req.p.spam_filter;
      }
      if (!_.isUndefined(req.p.strict_moderation)) {
        fields.strict_moderation = req.p.strict_moderation;
      }
      if (!_.isUndefined(req.p.topic)) {
        fields.topic = req.p.topic;
      }
      if (!_.isUndefined(req.p.description)) {
        fields.description = req.p.description;
      }
      if (!_.isUndefined(req.p.vis_type)) {
        fields.vis_type = req.p.vis_type;
      }
      if (!_.isUndefined(req.p.help_type)) {
        fields.help_type = req.p.help_type;
      }
      if (!_.isUndefined(req.p.socialbtn_type)) {
        fields.socialbtn_type = req.p.socialbtn_type;
      }
      if (!_.isUndefined(req.p.bgcolor)) {
        if (req.p.bgcolor === 'default') {
          fields.bgcolor = null;
        } else {
          fields.bgcolor = req.p.bgcolor;
        }
      }
      if (!_.isUndefined(req.p.help_color)) {
        if (req.p.help_color === 'default') {
          fields.help_color = null;
        } else {
          fields.help_color = req.p.help_color;
        }
      }
      if (!_.isUndefined(req.p.help_bgcolor)) {
        if (req.p.help_bgcolor === 'default') {
          fields.help_bgcolor = null;
        } else {
          fields.help_bgcolor = req.p.help_bgcolor;
        }
      }
      if (!_.isUndefined(req.p.style_btn)) {
        fields.style_btn = req.p.style_btn;
      }
      if (!_.isUndefined(req.p.write_type)) {
        fields.write_type = req.p.write_type;
      }
      if (!_.isUndefined(req.p.importance_enabled)) {
        fields.importance_enabled = req.p.importance_enabled;
      }
      ifDefinedSet('auth_opt_allow_3rdparty', req.p, fields);
      if (!_.isUndefined(req.p.owner_sees_participation_stats)) {
        fields.owner_sees_participation_stats = !!req.p.owner_sees_participation_stats;
      }
      if (!_.isUndefined(req.p.link_url)) {
        fields.link_url = req.p.link_url;
      }
      ifDefinedSet('subscribe_type', req.p, fields);
      const q = sql_conversations.update(fields).where(sql_conversations.zid.equals(req.p.zid)).returning('*');
      verifyMetaPromise.then(
        () => {
          pgQuery(q.toString(), (err, result) => {
            if (err) {
              fail(res, 500, 'polis_err_update_conversation', err);
              return;
            }
            const conv = result?.rows?.[0];
            conv.is_mod = true;
            const promise = generateShortUrl
              ? generateAndReplaceZinvite(req.p.zid, generateShortUrl)
              : Promise.resolve();
            const successCode = generateShortUrl ? 201 : 200;
            promise
              .then(() => {
                if (req.p.send_created_email) {
                  Promise.all([getUserInfoForUid2(req.p.uid), getConversationUrl(req, req.p.zid, true)])
                    .then((results) => {
                      const hname = results[0].hname;
                      const url = results[1];
                      sendEmailByUid(
                        req.p.uid,
                        'Conversation created',
                        `Hi ${hname},\n\nHere's a link to the conversation you just created. Use it to invite participants to the conversation. Share it by whatever network you prefer - Gmail, Facebook, Twitter, etc., or just post it to your website or blog. Try it now! Click this link to go to your conversation:\n${url}\n\nWith gratitude,\n\nThe team at pol.is\n`
                      ).catch((err) => {
                        logger.error('polis_err_sending_conversation_created_email', err);
                      });
                    })
                    .catch((err) => {
                      logger.error('polis_err_sending_conversation_created_email', err);
                    });
                }
                finishOne(res, conv, true, successCode);
                updateConversationModifiedTime(req.p.zid);
              })
              .catch((err) => {
                fail(res, 500, 'polis_err_update_conversation', err);
              });
          });
        },
        (err) => {
          fail(res, 500, err.message, err);
        }
      );
    })
    .catch((err) => {
      fail(res, 500, 'polis_err_update_conversation', err);
    });
}

function handle_GET_conversations(req, res) {
  let courseIdPromise = Promise.resolve();
  if (req.p.course_invite) {
    courseIdPromise = queryP_readOnly('select course_id from courses where course_invite = ($1);', [
      req.p.course_invite
    ]).then((rows) => rows[0].course_id);
  }
  courseIdPromise.then((course_id) => {
    if (course_id) {
      req.p.course_id = course_id;
    }
    const lang = null;
    if (req.p.zid) {
      getOneConversation(req.p.zid, req.p.uid, lang)
        .then(
          (data) => {
            finishOne(res, data);
          },
          (err) => {
            fail(res, 500, 'polis_err_get_conversations_2', err);
          }
        )
        .catch((err) => {
          fail(res, 500, 'polis_err_get_conversations_1', err);
        });
    } else if (req.p.uid || req.p.context) {
      getConversations(req, res);
    } else {
      fail(res, 403, 'polis_err_need_auth');
    }
  });
}

function handle_POST_reserve_conversation_id(_req, res) {
  const zid = 0;
  const shortUrl = false;
  generateAndRegisterZinvite(zid, shortUrl)
    .then((conversation_id) => {
      res.json({
        conversation_id: conversation_id
      });
    })
    .catch((err) => {
      fail(res, 500, 'polis_err_reserve_conversation_id', err);
    });
}

function handle_POST_conversations(req, res) {
  const xidStuffReady = Promise.resolve();
  xidStuffReady
    .then(() => {
      const generateShortUrl = req.p.short_url;
      isUserAllowedToCreateConversations(req.p.uid, (err, isAllowed) => {
        if (err) {
          fail(res, 403, 'polis_err_add_conversation_failed_user_check', err);
          return;
        }
        if (!isAllowed) {
          fail(res, 403, 'polis_err_add_conversation_not_enabled', new Error('polis_err_add_conversation_not_enabled'));
          return;
        }
        const q = sql_conversations
          .insert({
            owner: req.p.uid,
            org_id: req.p.org_id || req.p.uid,
            topic: req.p.topic,
            description: req.p.description,
            is_active: req.p.is_active,
            is_data_open: req.p.is_data_open,
            is_draft: req.p.is_draft,
            is_public: true,
            is_anon: req.p.is_anon,
            profanity_filter: req.p.profanity_filter,
            spam_filter: req.p.spam_filter,
            strict_moderation: req.p.strict_moderation,
            context: req.p.context || null,
            owner_sees_participation_stats: !!req.p.owner_sees_participation_stats,
            auth_needed_to_vote: DEFAULTS.auth_needed_to_vote,
            auth_needed_to_write: DEFAULTS.auth_needed_to_write,
            auth_opt_allow_3rdparty: req.p.auth_opt_allow_3rdparty || DEFAULTS.auth_opt_allow_3rdparty
          })
          .returning('*')
          .toString();
        pgQuery(q, [], (err, result) => {
          if (err) {
            if (isDuplicateKey(err)) {
              logger.error('polis_err_add_conversation', err);
              failWithRetryRequest(res);
            } else {
              fail(res, 500, 'polis_err_add_conversation', err);
            }
            return;
          }
          const zid = result?.rows?.[0]?.zid;
          const zinvitePromise = req.p.conversation_id
            ? getZidFromConversationId(req.p.conversation_id).then((zid) => {
                return zid === 0 ? req.p.conversation_id : null;
              })
            : generateAndRegisterZinvite(zid, generateShortUrl);
          zinvitePromise
            .then((zinvite) => {
              if (zinvite === null) {
                fail(res, 400, 'polis_err_conversation_id_already_in_use', err);
                return;
              }
              finishOne(res, {
                url: buildConversationUrl(req, zinvite),
                zid: zid
              });
            })
            .catch((err) => {
              fail(res, 500, 'polis_err_zinvite_create', err);
            });
        });
      });
    })
    .catch((err) => {
      fail(res, 500, 'polis_err_conversation_create', err);
    });
}

function handle_GET_conversationPreloadInfo(req, res) {
  return doGetConversationPreloadInfo(req.p.conversation_id).then(
    (conv) => {
      res.status(200).json(conv);
    },
    (err) => {
      fail(res, 500, 'polis_err_get_conversation_preload_info', err);
    }
  );
}

function handle_GET_implicit_conversation_generation(req, res) {
  let site_id = /polis_site_id[^/]*/.exec(req.path) || null;
  let page_id = /\S\/([^/]*)/.exec(req.path) || null;
  if (!site_id?.length || (page_id && page_id?.length < 2)) {
    fail(res, 404, 'polis_err_parsing_site_id_or_page_id');
  }
  site_id = site_id?.[0];
  page_id = page_id?.[1];
  const demo = req.p.demo;
  const ucv = req.p.ucv;
  const ucw = req.p.ucw;
  const ucsh = req.p.ucsh;
  const ucst = req.p.ucst;
  const ucsd = req.p.ucsd;
  const ucsv = req.p.ucsv;
  const ucsf = req.p.ucsf;
  const ui_lang = req.p.ui_lang;
  const subscribe_type = req.p.subscribe_type;
  const xid = req.p.xid;
  const x_name = req.p.x_name;
  const x_profile_image_url = req.p.x_profile_image_url;
  const x_email = req.p.x_email;
  const parent_url = req.p.parent_url;
  const dwok = req.p.dwok;
  const o = {};
  ifDefinedSet('parent_url', req.p, o);
  ifDefinedSet('auth_opt_allow_3rdparty', req.p, o);
  ifDefinedSet('topic', req.p, o);
  if (!_.isUndefined(req.p.show_vis)) {
    o.vis_type = req.p.show_vis ? 1 : 0;
  }
  if (!_.isUndefined(req.p.bg_white)) {
    o.bgcolor = req.p.bg_white ? '#fff' : null;
  }
  o.socialbtn_type = req.p.show_share ? 1 : 0;
  if (req.p.referrer) {
    setParentReferrerCookie(req, res, req.p.referrer);
  }
  if (req.p.parent_url) {
    setParentUrlCookie(req, res, req.p.parent_url);
  }
  function appendParams(url) {
    url += `?site_id=${site_id}&page_id=${page_id}`;
    if (!_.isUndefined(ucv)) {
      url += `&ucv=${ucv}`;
    }
    if (!_.isUndefined(ucw)) {
      url += `&ucw=${ucw}`;
    }
    if (!_.isUndefined(ucst)) {
      url += `&ucst=${ucst}`;
    }
    if (!_.isUndefined(ucsd)) {
      url += `&ucsd=${ucsd}`;
    }
    if (!_.isUndefined(ucsv)) {
      url += `&ucsv=${ucsv}`;
    }
    if (!_.isUndefined(ucsf)) {
      url += `&ucsf=${ucsf}`;
    }
    if (!_.isUndefined(ui_lang)) {
      url += `&ui_lang=${ui_lang}`;
    }
    if (!_.isUndefined(ucsh)) {
      url += `&ucsh=${ucsh}`;
    }
    if (!_.isUndefined(subscribe_type)) {
      url += `&subscribe_type=${subscribe_type}`;
    }
    if (!_.isUndefined(xid)) {
      url += `&xid=${xid}`;
    }
    if (!_.isUndefined(x_name)) {
      url += `&x_name=${encodeURIComponent(x_name)}`;
    }
    if (!_.isUndefined(x_profile_image_url)) {
      url += `&x_profile_image_url=${encodeURIComponent(x_profile_image_url)}`;
    }
    if (!_.isUndefined(x_email)) {
      url += `&x_email=${encodeURIComponent(x_email)}`;
    }
    if (!_.isUndefined(parent_url)) {
      url += `&parent_url=${encodeURIComponent(parent_url)}`;
    }
    if (!_.isUndefined(dwok)) {
      url += `&dwok=${dwok}`;
    }
    return url;
  }
  queryP_readOnly('select * from page_ids where site_id = ($1) and page_id = ($2);', [site_id, page_id])
    .then((rows) => {
      if (!rows || !rows.length) {
        initializeImplicitConversation(site_id, page_id, o)
          .then((conv) => {
            let url = _.isUndefined(demo)
              ? buildConversationUrl(req, conv.zinvite)
              : buildConversationDemoUrl(req, conv.zinvite);
            const modUrl = buildModerationUrl(req, conv.zinvite);
            const seedUrl = buildSeedUrl(req, conv.zinvite);
            sendImplicitConversationCreatedEmails(site_id, page_id, url, modUrl, seedUrl)
              .then(() => {
                logger.info('email sent');
              })
              .catch((err) => {
                logger.error('email fail', err);
              });
            url = appendParams(url);
            res.redirect(url);
          })
          .catch((err) => {
            fail(res, 500, 'polis_err_creating_conv', err);
          });
      } else {
        getZinvite(rows[0].zid)
          .then((conversation_id) => {
            let url = buildConversationUrl(req, conversation_id);
            url = appendParams(url);
            res.redirect(url);
          })
          .catch((err) => {
            fail(res, 500, 'polis_err_finding_conversation_id', err);
          });
      }
    })
    .catch((err) => {
      fail(res, 500, 'polis_err_redirecting_to_conv', err);
    });
}

function handle_GET_iip_conversation(req, res) {
  const conversation_id = req.params.conversation_id;
  res.set({
    'Content-Type': 'text/html'
  });
  res.send(`<a href='https://pol.is/${conversation_id}' target='_blank'>${conversation_id}</a>`);
}

function handle_GET_iim_conversation(req, res) {
  const zid = req.p.zid;
  const conversation_id = req.params.conversation_id;
  getConversationInfo(zid)
    .then((info) => {
      res.set({
        'Content-Type': 'text/html'
      });
      const title = info.topic || info.created;
      res.send(
        `<a href='https://pol.is/${conversation_id}' target='_blank'>${title}</a><p><a href='https://pol.is/m${conversation_id}' target='_blank'>moderate</a></p>${info.description ? `<p>${info.description}</p>` : ''}`
      );
    })
    .catch((err) => {
      fail(res, 500, 'polis_err_fetching_conversation_info', err);
    });
}

export {
  fetchIndexForConversation,
  getOneConversation,
  handle_GET_conversationPreloadInfo,
  handle_GET_conversations,
  handle_GET_conversationsRecentActivity,
  handle_GET_conversationsRecentlyStarted,
  handle_GET_conversationStats,
  handle_GET_iim_conversation,
  handle_GET_iip_conversation,
  handle_GET_implicit_conversation_generation,
  handle_POST_conversation_close,
  handle_POST_conversation_reopen,
  handle_POST_conversations,
  handle_POST_convSubscriptions,
  handle_POST_reserve_conversation_id,
  handle_PUT_conversations,
  updateConversationModifiedTime,
  updateLastInteractionTimeForConversation,
  updateVoteCount
};
