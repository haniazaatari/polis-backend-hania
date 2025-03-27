/* eslint-disable sonarjs/cognitive-complexity */
import async from 'async';
import request from 'request-promise';
import _ from 'underscore';
import Config from '../config.js';
import { isXidWhitelisted } from '../conversation.js';
import {
  query as pgQuery,
  queryP as pgQueryP,
  queryP_readOnly as pgQueryP_readOnly,
  query_readOnly as pgQuery_readOnly
} from '../db/pg-query.js';
import { sql_participants_extended } from '../db/sql.js';
import { getXids } from '../routes/math.js';
import { getVotesForSingleParticipant } from '../routes/votes.js';
import { encrypt } from '../session.js';
import { startSessionAndAddCookies } from '../session.js';
import { createDummyUser, getPid, getPidPromise, getUser, getUserInfoForUid2 } from '../user.js';
import { isConversationOwner, isDuplicateKey } from '../utils/common.js';
import { COOKIES, clearCookie, getPermanentCookieAndEnsureItIsSet } from '../utils/cookies.js';
import { fail } from '../utils/fail.js';
import logger from '../utils/logger.js';
import { MPromise } from '../utils/metered.js';
import { getPca } from '../utils/pca.js';
import { getNextComment } from './comment.js';
import { getConversationInfo, getOneConversation, updateLastInteractionTimeForConversation } from './conversation.js';
import { doFamousQuery } from './social.js';

function DD(f) {
  this.m = {};
  this.f = f;
}

function DA(f) {
  this.m = [];
  this.f = f;
}
DD.prototype.g = DA.prototype.g = function (k) {
  if (Object.prototype.hasOwnProperty.call(this.m, k)) {
    return this.m[k];
  }
  const v = this.f(k);
  this.m[k] = v;
  return v;
};

DD.prototype.s = DA.prototype.s = function (k, v) {
  this.m[k] = v;
};

function getSUZinviteInfo(suzinvite) {
  return new Promise((resolve, reject) => {
    pgQuery('SELECT * FROM suzinvites WHERE suzinvite = ($1);', [suzinvite], (err, results) => {
      if (err) {
        return reject(err);
      }
      if (!results || !results.rows || !results.rows.length) {
        return reject(new Error('polis_err_no_matching_suzinvite'));
      }
      resolve(results.rows[0]);
    });
  });
}
const deleteSuzinvite = async (suzinvite) => {
  try {
    await pgQuery('DELETE FROM suzinvites WHERE suzinvite = ($1);', [suzinvite]);
  } catch (err) {
    logger.error('polis_err_removing_suzinvite', err);
  }
};
function xidExists(xid, owner, uid) {
  return pgQueryP('select * from xids where xid = ($1) and owner = ($2) and uid = ($3);', [xid, owner, uid]).then(
    (rows) => rows?.length
  );
}
const createXidEntry = async (xid, owner, uid) => {
  try {
    await pgQueryP('INSERT INTO xids (uid, owner, xid) VALUES ($1, $2, $3);', [uid, owner, xid]);
  } catch (err) {
    logger.error('polis_err_adding_xid_entry', err);
    throw new Error('polis_err_adding_xid_entry');
  }
};

function isOwner(zid, uid) {
  return getConversationInfo(zid).then((info) => info.owner === uid);
}

function getParticipant(zid, uid) {
  return new MPromise('getParticipant', (resolve, reject) => {
    pgQuery_readOnly('SELECT * FROM participants WHERE zid = ($1) AND uid = ($2);', [zid, uid], (err, results) => {
      if (err) {
        return reject(err);
      }
      if (!results || !results.rows) {
        return reject(new Error('polis_err_getParticipant_failed'));
      }
      resolve(results.rows[0]);
    });
  });
}

function getUsersLocationName(_uid) {
  return Promise.resolve(null);
}

function geoCodeWithGoogleApi(locationString) {
  const googleApiKey = Config.googleApiKey;
  const address = encodeURI(locationString);
  if (!googleApiKey) {
    return Promise.reject('polis_err_geocoding_no_api_key');
  }
  return new Promise((resolve, reject) => {
    request
      .get(`https://maps.googleapis.com/maps/api/geocode/json?address=${address}&key=${googleApiKey}`)
      .then((response) => {
        response = JSON.parse(response);
        if (response.status !== 'OK') {
          reject('polis_err_geocoding_failed');
          return;
        }
        const bestResult = response.results[0];
        resolve(bestResult);
      }, reject)
      .catch(reject);
  });
}

function geoCode(locationString) {
  return geoCodeWithGoogleApi(locationString).then((result) => {
    const lat = result.geometry.location.lat;
    const lng = result.geometry.location.lng;
    const o = {
      lat: lat,
      lng: lng
    };
    return o;
  });
}

function populateParticipantLocationRecordIfPossible(zid, uid, pid) {
  getUsersLocationName(uid)
    .then((locationData) => {
      if (!locationData || !Config.googleApiKey) {
        return;
      }
      geoCode(locationData.location)
        .then((o) => {
          createParticpantLocationRecord(zid, uid, pid, o.lat, o.lng, locationData.source).catch((err) => {
            if (!isDuplicateKey(err)) {
              logger.error('polis_err_creating_particpant_location_record', err);
            }
          });
        })
        .catch((err) => {
          logger.error('polis_err_geocoding', err);
        });
    })
    .catch((err) => {
      logger.error('polis_err_fetching_user_location_name', err);
    });
}

function isOwnerOrParticipant(zid, uid, callback) {
  getPid(zid, uid, (err, pid) => {
    if (err || pid < 0) {
      isConversationOwner(zid, uid, (err) => {
        callback?.(err);
      });
    } else {
      callback?.(null);
    }
  });
}

function saveParticipantMetadataChoicesP(zid, pid, answers) {
  return new Promise((resolve, reject) => {
    saveParticipantMetadataChoices(zid, pid, answers, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve(0);
      }
    });
  });
}

function saveParticipantMetadataChoices(zid, pid, answers, callback) {
  if (!answers || !answers.length) {
    return callback(0);
  }
  const q = `select * from participant_metadata_answers where zid = ($1) and pmaid in (${answers.join(',')});`;
  pgQuery(q, [zid], (err, qa_results) => {
    if (err) {
      logger.error('polis_err_getting_participant_metadata_answers', err);
      return callback(err);
    }
    qa_results = qa_results.rows;
    qa_results = _.indexBy(qa_results, 'pmaid');
    answers = answers.map((pmaid) => {
      const pmqid = qa_results[pmaid].pmqid;
      return [zid, pid, pmaid, pmqid];
    });
    async.map(
      answers,
      (x, cb) => {
        pgQuery(
          'INSERT INTO participant_metadata_choices (zid, pid, pmaid, pmqid) VALUES ($1,$2,$3,$4);',
          x,
          (err, _results) => {
            if (err) {
              logger.error('polis_err_saving_participant_metadata_choices', err);
              return cb(err);
            }
            cb(0);
          }
        );
      },
      (err) => {
        if (err) {
          logger.error('polis_err_saving_participant_metadata_choices', err);
          return callback(err);
        }
        callback(0);
      }
    );
  });
}

function createParticpantLocationRecord(zid, uid, pid, lat, lng, source) {
  return pgQueryP('insert into participant_locations (zid, uid, pid, lat, lng, source) values ($1,$2,$3,$4,$5,$6);', [
    zid,
    uid,
    pid,
    lat,
    lng,
    source
  ]);
}

function addExtendedParticipantInfo(zid, uid, data) {
  if (!data || !_.keys(data).length) {
    return Promise.resolve();
  }
  const params = Object.assign({}, data, {
    zid: zid,
    uid: uid,
    modified: 9876543212345
  });
  const qUpdate = sql_participants_extended
    .update(params)
    .where(sql_participants_extended.zid.equals(zid))
    .and(sql_participants_extended.uid.equals(uid));
  let qString = qUpdate.toString();
  qString = qString.replace('9876543212345', 'now_as_millis()');
  return pgQueryP(qString, []);
}

function tryToJoinConversation(zid, uid, info, pmaid_answers) {
  function doAddExtendedParticipantInfo() {
    if (info && _.keys(info).length > 0) {
      addExtendedParticipantInfo(zid, uid, info);
    }
  }
  function saveMetadataChoices(pid) {
    if (pmaid_answers?.length) {
      saveParticipantMetadataChoicesP(zid, pid, pmaid_answers);
    }
  }
  return addParticipant(zid, uid).then((rows) => {
    const pid = rows?.[0]?.pid;
    const ptpt = rows[0];
    doAddExtendedParticipantInfo();
    if (pmaid_answers?.length) {
      saveMetadataChoices();
    }
    populateParticipantLocationRecordIfPossible(zid, uid, pid);
    return ptpt;
  });
}

function addParticipantAndMetadata(zid, uid, req, permanent_cookie) {
  const info = {};
  const parent_url = req?.cookies?.[COOKIES.PARENT_URL] || req?.p?.parent_url;
  const referer = req?.cookies[COOKIES.PARENT_REFERRER] || req?.headers?.referer || req?.headers?.referrer;
  if (parent_url) {
    info.parent_url = parent_url;
  }
  if (referer) {
    info.referrer = referer;
  }
  if (Config.applicationName === 'PolisWebServer') {
    const x_forwarded_for = req?.headers?.['x-forwarded-for'];
    let ip = null;
    if (x_forwarded_for) {
      let ips = x_forwarded_for;
      ips = ips?.split(', ');
      ip = ips.length && ips[0];
      info.encrypted_ip_address = encrypt(ip);
      info.encrypted_x_forwarded_for = encrypt(x_forwarded_for);
    }
  }
  if (permanent_cookie) {
    info.permanent_cookie = permanent_cookie;
  }
  if (req?.headers?.origin) {
    info.origin = req?.headers?.origin;
  }
  return addParticipant(zid, uid).then((rows) => {
    const ptpt = rows[0];
    const pid = ptpt.pid;
    populateParticipantLocationRecordIfPossible(zid, uid, pid);
    addExtendedParticipantInfo(zid, uid, info);
    return rows;
  });
}

function joinConversation(zid, uid, info, pmaid_answers) {
  function tryJoin() {
    return tryToJoinConversation(zid, uid, info, pmaid_answers);
  }
  function doJoin() {
    const promise = tryJoin()
      .catch(tryJoin)
      .catch(tryJoin)
      .catch(tryJoin)
      .catch(tryJoin)
      .catch(tryJoin)
      .catch(tryJoin)
      .catch(tryJoin)
      .catch(tryJoin)
      .catch(tryJoin);
    return promise;
  }
  return getPidPromise(zid, uid).then((pid) => {
    if (pid >= 0) {
      return;
    }
    return doJoin();
  }, doJoin);
}

const addParticipant = async (zid, uid) => {
  await pgQueryP('INSERT INTO participants_extended (zid, uid) VALUES ($1, $2);', [zid, uid]);
  return pgQueryP('INSERT INTO participants (pid, zid, uid, created) VALUES (NULL, $1, $2, default) RETURNING *;', [
    zid,
    uid
  ]);
};

function getAnswersForConversation(zid, callback) {
  pgQuery_readOnly('SELECT * from participant_metadata_answers WHERE zid = ($1) AND alive=TRUE;', [zid], (err, x) => {
    if (err) {
      callback(err);
      return;
    }
    callback(0, x.rows);
  });
}

function userHasAnsweredZeQuestions(zid, answers) {
  return new MPromise('userHasAnsweredZeQuestions', (resolve, reject) => {
    getAnswersForConversation(zid, (err, available_answers) => {
      if (err) {
        reject(err);
        return;
      }
      const q2a = _.indexBy(available_answers, 'pmqid');
      const a2q = _.indexBy(available_answers, 'pmaid');
      for (let i = 0; i < answers.length; i++) {
        const pmqid = a2q[answers[i]].pmqid;
        delete q2a[pmqid];
      }
      const remainingKeys = _.keys(q2a);
      const missing = remainingKeys && remainingKeys.length > 0;
      if (missing) {
        return reject(new Error(`polis_err_metadata_not_chosen_pmqid_${remainingKeys[0]}`));
      }
      return resolve();
    });
  });
}

function recordPermanentCookieZidJoin(permanentCookieToken, zid) {
  function doInsert() {
    return pgQueryP('insert into permanentCookieZidJoins (cookie, zid) values ($1, $2);', [permanentCookieToken, zid]);
  }
  return pgQueryP('select zid from permanentCookieZidJoins where cookie = ($1) and zid = ($2);', [
    permanentCookieToken,
    zid
  ]).then(
    (rows) => {
      if (rows?.length) {
        // noop
      } else {
        return doInsert();
      }
    },
    (err) => {
      logger.error('error in recordPermanentCookieZidJoin', err);
      return doInsert();
    }
  );
}

function handle_GET_participants(req, res) {
  const uid = req.p.uid;
  const zid = req.p.zid;
  pgQueryP_readOnly('select * from participants where uid = ($1) and zid = ($2)', [uid, zid])
    .then((rows) => {
      const ptpt = (rows?.length && rows[0]) || null;
      res.status(200).json(ptpt);
    })
    .catch((err) => {
      fail(res, 500, 'polis_err_get_participant', err);
    });
}

function handle_POST_participants(req, res) {
  const zid = req.p.zid;
  const uid = req.p.uid;
  const answers = req.p.answers;
  const info = {};
  const parent_url = req.cookies[COOKIES.PARENT_URL] || req.p.parent_url;
  const referrer = req.cookies[COOKIES.PARENT_REFERRER] || req.p.referrer;
  if (parent_url) {
    info.parent_url = parent_url;
  }
  if (referrer) {
    info.referrer = referrer;
  }
  function finish(ptpt) {
    clearCookie(req, res, COOKIES.PARENT_URL);
    clearCookie(req, res, COOKIES.PARENT_REFERRER);
    setTimeout(() => {
      updateLastInteractionTimeForConversation(zid, uid);
    }, 0);
    res.status(200).json(ptpt);
  }

  function doJoin() {
    userHasAnsweredZeQuestions(zid, answers).then(
      () => {
        joinConversation(zid, uid, info, answers).then(
          (ptpt) => {
            finish(ptpt);
          },
          (err) => {
            fail(res, 500, 'polis_err_add_participant', err);
          }
        );
      },
      (err) => {
        fail(res, 400, err.message, err);
      }
    );
  }
  getParticipant(zid, req.p.uid)
    .then(
      (ptpt) => {
        if (ptpt) {
          finish(ptpt);
          populateParticipantLocationRecordIfPossible(zid, req.p.uid, ptpt.pid);
          addExtendedParticipantInfo(zid, req.p.uid, info);
          return;
        }
        getConversationInfo(zid)
          .then(() => {
            doJoin();
          })
          .catch((err) => {
            fail(res, 500, 'polis_err_post_participants_need_uid_to_check_lti_users_4', err);
          });
      },
      (err) => {
        fail(res, 500, 'polis_err_post_participants_db_err', err);
      }
    )
    .catch((err) => {
      fail(res, 500, 'polis_err_post_participants_misc', err);
    });
}

function handle_GET_participation(req, res) {
  const zid = req.p.zid;
  const uid = req.p.uid;
  const strict = req.p.strict;
  isOwner(zid, uid)
    .then((ok) => {
      if (!ok) {
        fail(res, 403, 'polis_err_get_participation_auth');
        return;
      }
      return Promise.all([
        pgQueryP_readOnly('select pid, count(*) from votes where zid = ($1) group by pid;', [zid]),
        pgQueryP_readOnly('select pid, count(*) from comments where zid = ($1) group by pid;', [zid]),
        getXids(zid)
      ]).then((o) => {
        const voteCountRows = o[0];
        const commentCountRows = o[1];
        const pidXidRows = o[2];
        let i;
        let r;
        if (strict && !pidXidRows.length) {
          fail(
            res,
            409,
            'polis_err_get_participation_missing_xids This conversation has no xids for its participants.'
          );
          return;
        }
        let result = new DD(() => ({
          votes: 0,
          comments: 0
        }));
        for (i = 0; i < voteCountRows.length; i++) {
          r = voteCountRows[i];
          result.g(r.pid).votes = Number(r.count);
        }
        for (i = 0; i < commentCountRows.length; i++) {
          r = commentCountRows[i];
          result.g(r.pid).comments = Number(r.count);
        }
        result = result.m;
        if (pidXidRows?.length) {
          const pidToXid = {};
          for (i = 0; i < pidXidRows.length; i++) {
            pidToXid[pidXidRows[i].pid] = pidXidRows[i].xid;
          }
          const xidBasedResult = {};
          let size = 0;
          _.each(result, (val, key) => {
            xidBasedResult[pidToXid[key]] = val;
            size += 1;
          });
          if (strict && (commentCountRows.length || voteCountRows.length) && size > 0) {
            fail(
              res,
              409,
              'polis_err_get_participation_missing_xids This conversation is missing xids for some of its participants.'
            );
            return;
          }
          res.status(200).json(xidBasedResult);
        } else {
          res.status(200).json(result);
        }
      });
    })
    .catch((err) => {
      fail(res, 500, 'polis_err_get_participation_misc', err);
    });
}

function handle_GET_participationInit(req, res) {
  logger.info('handle_GET_participationInit');
  function ifConv(f, args) {
    if (req.p.conversation_id) {
      return f.apply(null, args);
    }
    return Promise.resolve(null);
  }
  function ifConvAndAuth(f, args) {
    if (req.p.uid) {
      return ifConv(f, args);
    }
    return Promise.resolve(null);
  }
  const acceptLanguage = req?.headers?.['accept-language'] || req?.headers?.['Accept-Language'] || 'en-US';
  if (req.p.lang === 'acceptLang') {
    req.p.lang = acceptLanguage.substr(0, 2);
  }
  getPermanentCookieAndEnsureItIsSet(req, res);
  Promise.all([
    getUser(req.p.uid, req.p.zid, req.p.xid, req.p.owner_uid),
    ifConvAndAuth(getParticipant, [req.p.zid, req.p.uid]),
    ifConv(getNextComment, [req.p.zid, req.p.pid, [], true, req.p.lang]),
    ifConv(getOneConversation, [req.p.zid, req.p.uid, req.p.lang]),
    ifConv(getVotesForSingleParticipant, [req.p]),
    ifConv(getPca, [req.p.zid, -1]),
    ifConv(doFamousQuery, [req.p, req])
  ])
    .then(
      (arr) => {
        const conv = arr[3];
        const o = {
          user: arr[0],
          ptpt: arr[1],
          nextComment: arr[2],
          conversation: conv,
          votes: arr[4] || [],
          pca: arr[5] ? (arr[5].asJSON ? arr[5].asJSON : null) : null,
          famous: arr[6],
          acceptLanguage: acceptLanguage
        };
        if (o.conversation) {
          o.conversation.zid = undefined;
          o.conversation.conversation_id = req.p.conversation_id;
        }
        if (o.ptpt) {
          o.ptpt.zid = undefined;
        }
        for (let i = 0; i < o.votes.length; i++) {
          o.votes[i].zid = undefined;
        }
        if (!o.nextComment) {
          o.nextComment = {};
        }
        if (!_.isUndefined(req.p.pid)) {
          o.nextComment.currentPid = req.p.pid;
        }
        res.status(200).json(o);
      },
      (err) => {
        fail(res, 500, 'polis_err_get_participationInit2', err);
      }
    )
    .catch((err) => {
      fail(res, 500, 'polis_err_get_participationInit', err);
    });
}

function handle_PUT_participants_extended(req, res) {
  const zid = req.p.zid;
  const uid = req.p.uid;
  const fields = {};
  if (!_.isUndefined(req.p.show_translation_activated)) {
    fields.show_translation_activated = req.p.show_translation_activated;
  }
  const q = sql_participants_extended
    .update(fields)
    .where(sql_participants_extended.zid.equals(zid))
    .and(sql_participants_extended.uid.equals(uid));
  pgQueryP(q.toString(), [])
    .then((result) => {
      res.json(result);
    })
    .catch((err) => {
      fail(res, 500, 'polis_err_put_participants_extended', err);
    });
}

function handle_POST_query_participants_by_metadata(req, res) {
  const uid = req.p.uid;
  const zid = req.p.zid;
  const pmaids = req.p.pmaids;
  if (!pmaids.length) {
    return res.status(200).json([]);
  }
  function doneChecking() {
    pgQuery_readOnly(
      `select pid from participants where zid = ($1) and pid not in (select pid from participant_metadata_choices where alive = TRUE and pmaid in (select pmaid from participant_metadata_answers where alive = TRUE and zid = ($2) and pmaid not in (${pmaids.join(',')})));`,
      [zid, zid],
      (err, results) => {
        if (err) {
          fail(res, 500, 'polis_err_metadata_query', err);
          return;
        }
        res.status(200).json(_.pluck(results.rows, 'pid'));
      }
    );
  }
  isOwnerOrParticipant(zid, uid, doneChecking);
}

function handle_POST_joinWithInvite(req, res) {
  return joinWithZidOrSuzinvite({
    answers: req.p.answers,
    existingAuth: !!req.p.uid,
    suzinvite: req.p.suzinvite,
    permanentCookieToken: req.p.permanentCookieToken,
    uid: req.p.uid,
    zid: req.p.zid,
    referrer: req.p.referrer,
    parent_url: req.p.parent_url
  })
    .then((o) => {
      const uid = o.uid;
      logger.info(`startSessionAndAddCookies ${uid} existing ${o.existingAuth}`);
      if (!o.existingAuth) {
        return startSessionAndAddCookies(req, res, uid).then(() => o);
      }
      return Promise.resolve(o);
    })
    .then((o) => {
      logger.info('permanentCookieToken', o.permanentCookieToken);
      if (o.permanentCookieToken) {
        return recordPermanentCookieZidJoin(o.permanentCookieToken, o.zid).then(
          () => o,
          () => o
        );
      }
      return o;
    })
    .then((o) => {
      const pid = o.pid;
      res.status(200).json({
        pid: pid,
        uid: req.p.uid
      });
    })
    .catch((err) => {
      if (err?.message?.match(/polis_err_need_full_user/)) {
        fail(res, 403, err.message, err);
      } else if (err?.message) {
        fail(res, 500, err.message, err);
      } else if (err) {
        fail(res, 500, 'polis_err_joinWithZidOrSuzinvite', err);
      } else {
        fail(res, 500, 'polis_err_joinWithZidOrSuzinvite');
      }
    });
}

function joinWithZidOrSuzinvite(o) {
  return Promise.resolve(o)
    .then((o) => {
      if (o.suzinvite) {
        return getSUZinviteInfo(o.suzinvite).then((suzinviteInfo) => Object.assign(o, suzinviteInfo));
      }
      if (o.zid) {
        return o;
      }
      throw new Error('polis_err_missing_invite');
    })
    .then((o) => {
      logger.info('joinWithZidOrSuzinvite convinfo begin');
      return getConversationInfo(o.zid).then((conv) => {
        logger.info('joinWithZidOrSuzinvite convinfo done');
        o.conv = conv;
        return o;
      });
    })
    .then((o) => o)
    .then((o) => {
      logger.info('joinWithZidOrSuzinvite userinfo begin');
      if (!o.uid) {
        logger.info('joinWithZidOrSuzinvite userinfo no uid');
        return o;
      }
      return getUserInfoForUid2(o.uid).then((user) => {
        logger.info('joinWithZidOrSuzinvite userinfo done');
        o.user = user;
        return o;
      });
    })
    .then((o) => {
      if (o.uid) {
        return o;
      }
      return createDummyUser().then((uid) =>
        Object.assign(o, {
          uid: uid
        })
      );
    })
    .then((o) => userHasAnsweredZeQuestions(o.zid, o.answers).then(() => o))
    .then((o) => {
      const info = {};
      if (o.referrer) {
        info.referrer = o.referrer;
      }
      if (o.parent_url) {
        info.parent_url = o.parent_url;
      }
      return joinConversation(o.zid, o.uid, info, o.answers).then((ptpt) => Object.assign(o, ptpt));
    })
    .then((o) => {
      if (o.xid) {
        return xidExists(o.xid, o.conv.org_id, o.uid).then((exists) => {
          if (exists) {
            return o;
          }
          const shouldCreateXidEntryPromise = o.conv.use_xid_whitelist
            ? isXidWhitelisted(o.conv.owner, o.xid)
            : Promise.resolve(true);
          shouldCreateXidEntryPromise.then((should) => {
            if (should) {
              return createXidEntry(o.xid, o.conv.org_id, o.uid).then(() => o);
            }
            throw new Error('polis_err_xid_not_whitelisted');
          });
        });
      }
      return o;
    })
    .then((o) => {
      if (o.suzinvite) {
        return deleteSuzinvite(o.suzinvite).then(() => o);
      }
      return o;
    });
}

export default {
  addParticipant,
  addParticipantAndMetadata,
  handle_GET_participants,
  handle_GET_participation,
  handle_GET_participationInit,
  handle_POST_joinWithInvite,
  handle_POST_participants,
  handle_POST_query_participants_by_metadata,
  handle_PUT_participants_extended
};
