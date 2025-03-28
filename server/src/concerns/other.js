import _ from 'underscore';
import { generateAndRegisterZinvite } from '../auth/create-user.js';
import { query as pgQuery, queryP, queryP_readOnly, query_readOnly } from '../db/pg-query.js';
import { sql_users } from '../db/sql.js';
import { getUser } from '../user.js';
import { isDuplicateKey, isPolisDev } from '../utils/common.js';
import { COOKIES } from '../utils/cookies.js';
import { fail } from '../utils/fail.js';
import { METRICS_IN_RAM } from '../utils/metered.js';
import { getPidsForGid } from '../utils/participants.js';
import { updateConversationModifiedTime } from './conversation.js';
import { doSendEinvite, emailFeatureRequest, emailTeam } from './email.js';

function hashStringToInt32(s) {
  let h = 1;
  if (typeof s !== 'string' || !s.length) {
    return 99;
  }
  for (let i = 0; i < s.length; i++) {
    h = h * s.charCodeAt(i) * 31;
  }
  if (h < 0) {
    h = -h;
  }
  while (h > 2147483648) {
    h = h / 2;
  }
  return h;
}

function getLocationsForParticipants(zid) {
  return queryP_readOnly('select * from participant_locations where zid = ($1);', [zid]);
}

function handle_POST_metrics(req, res) {
  const enabled = false;
  if (!enabled) {
    return res.status(200).json({});
  }
  const pc = req.cookies[COOKIES.PERMANENT_COOKIE];
  const hashedPc = hashStringToInt32(pc);
  const uid = req.p.uid || null;
  const durs = req.p.durs.map((dur) => {
    if (dur === -1) {
      dur = null;
    }
    return dur;
  });
  const clientTimestamp = req.p.clientTimestamp;
  const ages = req.p.times.map((t) => clientTimestamp - t);
  const now = Date.now();
  const timesInTermsOfServerTime = ages.map((a) => now - a);
  const len = timesInTermsOfServerTime.length;
  const entries = [];
  for (let i = 0; i < len; i++) {
    entries.push(`(${[uid || 'null', req.p.types[i], durs[i], hashedPc, timesInTermsOfServerTime[i]].join(',')})`);
  }
  queryP(`insert into metrics (uid, type, dur, hashedPc, created) values ${entries.join(',')};`, [])
    .then((_result) => {
      res.json({});
    })
    .catch((err) => {
      fail(res, 500, 'polis_err_metrics_post', err);
    });
}

function handle_GET_zinvites(req, res) {
  query_readOnly(
    'SELECT * FROM conversations WHERE zid = ($1) AND owner = ($2);',
    [req.p.zid, req.p.uid],
    (err, results) => {
      if (err) {
        fail(res, 500, 'polis_err_fetching_zinvite_invalid_conversation_or_owner', err);
        return;
      }
      if (!results || !results.rows) {
        res.writeHead(404);
        res.json({
          status: 404
        });
        return;
      }
      query_readOnly('SELECT * FROM zinvites WHERE zid = ($1);', [req.p.zid], (err, results) => {
        if (err) {
          fail(res, 500, 'polis_err_fetching_zinvite_invalid_conversation_or_owner_or_something', err);
          return;
        }
        if (!results || !results.rows) {
          res.writeHead(404);
          res.json({
            status: 404
          });
          return;
        }
        res.status(200).json({
          codes: results.rows
        });
      });
    }
  );
}

function handle_POST_zinvites(req, res) {
  const generateShortUrl = req.p.short_url;
  pgQuery('SELECT * FROM conversations WHERE zid = ($1) AND owner = ($2);', [req.p.zid, req.p.uid], (err, _results) => {
    if (err) {
      fail(res, 500, 'polis_err_creating_zinvite_invalid_conversation_or_owner', err);
      return;
    }
    generateAndRegisterZinvite(req.p.zid, generateShortUrl)
      .then((zinvite) => {
        res.status(200).json({
          zinvite: zinvite
        });
      })
      .catch((err) => {
        fail(res, 500, 'polis_err_creating_zinvite', err);
      });
  });
}

function handle_GET_dummyButton(req, res) {
  const message = `${req.p.button} ${req.p.uid}`;
  emailFeatureRequest(message);
  res.status(200).end();
}

function handle_GET_perfStats(_req, res) {
  res.json(METRICS_IN_RAM);
}

function handle_GET_snapshot(req, _res) {
  const _uid = req.p.uid;
  const _zid = req.p.zid;

  throw new Error('TODO Needs to clone participants_extended and any other new tables as well.');
}

function handle_POST_tutorial(req, res) {
  const uid = req.p.uid;
  const step = req.p.step;
  queryP('update users set tut = ($1) where uid = ($2);', [step, uid])
    .then(() => {
      res.status(200).json({});
    })
    .catch((err) => {
      fail(res, 500, 'polis_err_saving_tutorial_state', err);
    });
}

function handle_GET_users(req, res) {
  const uid = req.p.uid;
  if (req.p.errIfNoAuth && !uid) {
    fail(res, 401, 'polis_error_auth_needed');
    return;
  }
  getUser(uid, null, req.p.xid, req.p.owner_uid)
    .then(
      (user) => {
        res.status(200).json(user);
      },
      (err) => {
        fail(res, 500, 'polis_err_getting_user_info2', err);
      }
    )
    .catch((err) => {
      fail(res, 500, 'polis_err_getting_user_info', err);
    });
}

function handle_POST_trashes(req, res) {
  const query = 'INSERT INTO trashes (pid, zid, tid, trashed, created) VALUES ($1, $2, $3, $4, default);';
  const params = [req.p.pid, req.p.zid, req.p.tid, req.p.trashed];
  query(query, params, (err, result) => {
    if (err) {
      if (isDuplicateKey(err)) {
        fail(res, 406, 'polis_err_vote_duplicate', err);
      } else {
        fail(res, 500, 'polis_err_vote', err);
      }
      return;
    }
    const createdTime = result.rows[0].created;
    setTimeout(() => {
      updateConversationModifiedTime(req.p.zid, createdTime);
    }, 100);
    res.status(200).json({});
  });
}

function handle_PUT_users(req, res) {
  let uid = req.p.uid;
  if (isPolisDev(uid) && req.p.uid_of_user) {
    uid = req.p.uid_of_user;
  }
  const fields = {};
  if (!_.isUndefined(req.p.email)) {
    fields.email = req.p.email;
  }
  if (!_.isUndefined(req.p.hname)) {
    fields.hname = req.p.hname;
  }
  const q = sql_users.update(fields).where(sql_users.uid.equals(uid));
  queryP(q.toString(), [])
    .then((result) => {
      res.json(result);
    })
    .catch((err) => {
      fail(res, 500, 'polis_err_put_user', err);
    });
}

function handle_GET_contexts(_req, res) {
  queryP_readOnly('select name from contexts where is_public = TRUE order by name;', [])
    .then(
      (contexts) => {
        res.status(200).json(contexts);
      },
      (err) => {
        fail(res, 500, 'polis_err_get_contexts_query', err);
      }
    )
    .catch((err) => {
      fail(res, 500, 'polis_err_get_contexts_misc', err);
    });
}

function handle_POST_contexts(req, res) {
  const uid = req.p.uid;
  const name = req.p.name;
  function createContext() {
    return queryP('insert into contexts (name, creator, is_public) values ($1, $2, $3);', [name, uid, true])
      .then(
        () => {
          res.status(200).json({});
        },
        (err) => {
          fail(res, 500, 'polis_err_post_contexts_query', err);
        }
      )
      .catch((err) => {
        fail(res, 500, 'polis_err_post_contexts_misc', err);
      });
  }
  queryP('select name from contexts where name = ($1);', [name])
    .then(
      (rows) => {
        const exists = rows?.length;
        if (exists) {
          fail(res, 422, 'polis_err_post_context_exists');
          return;
        }
        return createContext();
      },
      (err) => {
        fail(res, 500, 'polis_err_post_contexts_check_query', err);
      }
    )
    .catch((err) => {
      fail(res, 500, 'polis_err_post_contexts_check_misc', err);
    });
}

function handle_GET_locations(req, res) {
  const zid = req.p.zid;
  const gid = req.p.gid;
  Promise.all([getPidsForGid(zid, gid, -1), getLocationsForParticipants(zid)])
    .then((o) => {
      const pids = o[0];
      let locations = o[1];
      locations = locations.filter((locData) => {
        const pidIsInGroup = _.indexOf(pids, locData.pid, true) >= 0;
        return pidIsInGroup;
      });
      locations = locations.map((locData) => ({
        lat: locData.lat,
        lng: locData.lng,
        n: 1
      }));
      res.status(200).json(locations);
    })
    .catch((err) => {
      fail(res, 500, 'polis_err_locations_01', err);
    });
}

function handle_POST_einvites(req, res) {
  const email = req.p.email;
  doSendEinvite(req, email)
    .then(() => {
      res.status(200).json({});
    })
    .catch((err) => {
      fail(res, 500, 'polis_err_sending_einvite', err);
    });
}

function handle_GET_einvites(req, res) {
  const einvite = req.p.einvite;
  queryP('select * from einvites where einvite = ($1);', [einvite])
    .then((rows) => {
      if (!rows.length) {
        throw new Error('polis_err_missing_einvite');
      }
      res.status(200).json(rows[0]);
    })
    .catch((err) => {
      fail(res, 500, 'polis_err_fetching_einvite', err);
    });
}

function handle_POST_contributors(req, res) {
  const uid = req.p.uid || null;
  const agreement_version = req.p.agreement_version;
  const name = req.p.name;
  const email = req.p.email;
  const github_id = req.p.github_id;
  const company_name = req.p.company_name;
  queryP(
    'insert into contributor_agreement_signatures (uid, agreement_version, github_id, name, email, company_name) ' +
      'values ($1, $2, $3, $4, $5, $6);',
    [uid, agreement_version, github_id, name, email, company_name]
  ).then(
    () => {
      emailTeam(
        'contributer agreement signed',
        [uid, agreement_version, github_id, name, email, company_name].join('\n')
      );
      res.json({});
    },
    (err) => {
      fail(res, 500, 'polis_err_POST_contributors_misc', err);
    }
  );
}

function handle_GET_testConnection(_req, res) {
  res.status(200).json({
    status: 'ok'
  });
}

function handle_GET_testDatabase(_req, res) {
  queryP('select uid from users limit 1', []).then(
    (_rows) => {
      res.status(200).json({
        status: 'ok'
      });
    },
    (err) => {
      fail(res, 500, 'polis_err_testDatabase', err);
    }
  );
}

export {
  handle_GET_contexts,
  handle_GET_dummyButton,
  handle_GET_einvites,
  handle_GET_locations,
  handle_GET_perfStats,
  handle_GET_snapshot,
  handle_GET_testConnection,
  handle_GET_testDatabase,
  handle_GET_users,
  handle_GET_zinvites,
  handle_POST_contexts,
  handle_POST_contributors,
  handle_POST_einvites,
  handle_POST_metrics,
  handle_POST_trashes,
  handle_POST_tutorial,
  handle_POST_zinvites,
  handle_PUT_users
};
