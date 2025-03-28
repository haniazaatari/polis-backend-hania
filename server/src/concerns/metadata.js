import async from 'async';
import { query as pgQuery, query_readOnly } from '../db/pg-query.js';
import { sql_participant_metadata_answers } from '../db/sql.js';
import { isConversationOwner } from '../utils/common.js';
import { fail } from '../utils/fail.js';
import logger from '../utils/logger.js';
import { finishArray, finishOne } from './response.js';

function checkZinviteCodeValidity(zid, zinvite, callback) {
  query_readOnly('SELECT * FROM zinvites WHERE zid = ($1) AND zinvite = ($2);', [zid, zinvite], (err, results) => {
    if (err || !results || !results.rows || !results.rows.length) {
      callback(1);
    } else {
      callback(null);
    }
  });
}

function checkSuzinviteCodeValidity(zid, suzinvite, callback) {
  pgQuery('SELECT * FROM suzinvites WHERE zid = ($1) AND suzinvite = ($2);', [zid, suzinvite], (err, results) => {
    if (err || !results || !results.rows || !results.rows.length) {
      callback(1);
    } else {
      callback(null);
    }
  });
}

function getChoicesForConversation(zid) {
  return new Promise((resolve, reject) => {
    query_readOnly('select * from participant_metadata_choices where zid = ($1) and alive = TRUE;', [zid], (err, x) => {
      if (err) {
        reject(err);
        return;
      }
      if (!x || !x.rows) {
        resolve([]);
        return;
      }
      resolve(x.rows);
    });
  });
}

function getZidForQuestion(pmqid, callback) {
  pgQuery('SELECT zid FROM participant_metadata_questions WHERE pmqid = ($1);', [pmqid], (err, result) => {
    if (err) {
      logger.error('polis_err_zid_missing_for_question', err);
      callback(err);
      return;
    }
    if (!result.rows || !result.rows.length) {
      callback('polis_err_zid_missing_for_question');
      return;
    }
    callback(null, result.rows[0].zid);
  });
}

function deleteMetadataQuestionAndAnswers(pmqid, callback) {
  pgQuery('update participant_metadata_answers set alive = FALSE where pmqid = ($1);', [pmqid], (err) => {
    if (err) {
      callback(err);
      return;
    }
    pgQuery('update participant_metadata_questions set alive = FALSE where pmqid = ($1);', [pmqid], (err) => {
      if (err) {
        callback(err);
        return;
      }
      callback(null);
    });
  });
}

function handle_DELETE_metadata_questions(req, res) {
  const uid = req.p.uid;
  const pmqid = req.p.pmqid;
  getZidForQuestion(pmqid, (err, zid) => {
    if (err) {
      fail(res, 500, 'polis_err_delete_participant_metadata_questions_zid', err);
      return;
    }
    isConversationOwner(zid, uid, (err) => {
      if (err) {
        fail(res, 403, 'polis_err_delete_participant_metadata_questions_auth', err);
        return;
      }
      deleteMetadataQuestionAndAnswers(pmqid, (err) => {
        if (err) {
          fail(res, 500, 'polis_err_delete_participant_metadata_question', new Error(err));
          return;
        }
        res.send(200);
      });
    });
  });
}

function handle_GET_metadata_questions(req, res) {
  const zid = req.p.zid;
  const zinvite = req.p.zinvite;
  const suzinvite = req.p.suzinvite;
  function doneChecking(err, _foo) {
    if (err) {
      fail(res, 403, 'polis_err_get_participant_metadata_auth', err);
      return;
    }
    async.parallel(
      [
        (callback) => {
          query_readOnly(
            'SELECT * FROM participant_metadata_questions WHERE alive = true AND zid = ($1);',
            [zid],
            callback
          );
        }
      ],
      (err, result) => {
        if (err) {
          fail(res, 500, 'polis_err_get_participant_metadata_questions', err);
          return;
        }
        let rows = result[0]?.rows;
        rows = rows.map((r) => {
          r.required = true;
          return r;
        });
        finishArray(res, rows);
      }
    );
  }
  if (zinvite) {
    checkZinviteCodeValidity(zid, zinvite, doneChecking);
  } else if (suzinvite) {
    checkSuzinviteCodeValidity(zid, suzinvite, doneChecking);
  } else {
    doneChecking(false);
  }
}

function handle_POST_metadata_questions(req, res) {
  const zid = req.p.zid;
  const key = req.p.key;
  const uid = req.p.uid;
  function doneChecking(err, _foo) {
    if (err) {
      fail(res, 403, 'polis_err_post_participant_metadata_auth', err);
      return;
    }
    pgQuery(
      'INSERT INTO participant_metadata_questions (pmqid, zid, key) VALUES (default, $1, $2) RETURNING *;',
      [zid, key],
      (err, results) => {
        if (err || !results || !results.rows || !results.rows.length) {
          fail(res, 500, 'polis_err_post_participant_metadata_key', err);
          return;
        }
        finishOne(res, results.rows[0]);
      }
    );
  }
  isConversationOwner(zid, uid, doneChecking);
}

function handle_POST_metadata_answers(req, res) {
  const zid = req.p.zid;
  const uid = req.p.uid;
  const pmqid = req.p.pmqid;
  const value = req.p.value;
  function doneChecking(err, _foo) {
    if (err) {
      fail(res, 403, 'polis_err_post_participant_metadata_auth', err);
      return;
    }
    pgQuery(
      'INSERT INTO participant_metadata_answers (pmqid, zid, value, pmaid) VALUES ($1, $2, $3, default) RETURNING *;',
      [pmqid, zid, value],
      (err, results) => {
        if (err || !results || !results.rows || !results.rows.length) {
          pgQuery(
            'UPDATE participant_metadata_answers set alive = TRUE where pmqid = ($1) AND zid = ($2) AND value = ($3) RETURNING *;',
            [pmqid, zid, value],
            (err, results) => {
              if (err) {
                fail(res, 500, 'polis_err_post_participant_metadata_value', err);
                return;
              }
              finishOne(res, results.rows[0]);
            }
          );
        } else {
          finishOne(res, results.rows[0]);
        }
      }
    );
  }
  isConversationOwner(zid, uid, doneChecking);
}

function handle_GET_metadata_choices(req, res) {
  const zid = req.p.zid;
  getChoicesForConversation(zid).then(
    (choices) => {
      finishArray(res, choices);
    },
    (err) => {
      fail(res, 500, 'polis_err_get_participant_metadata_choices', err);
    }
  );
}

function handle_GET_metadata_answers(req, res) {
  const zid = req.p.zid;
  const zinvite = req.p.zinvite;
  const suzinvite = req.p.suzinvite;
  const pmqid = req.p.pmqid;
  function doneChecking(err, _foo) {
    if (err) {
      fail(res, 403, 'polis_err_get_participant_metadata_auth', err);
      return;
    }
    let query = sql_participant_metadata_answers
      .select(sql_participant_metadata_answers.star())
      .where(sql_participant_metadata_answers.zid.equals(zid))
      .and(sql_participant_metadata_answers.alive.equals(true));
    if (pmqid) {
      query = query.where(sql_participant_metadata_answers.pmqid.equals(pmqid));
    }
    query_readOnly(query.toString(), (err, result) => {
      if (err) {
        fail(res, 500, 'polis_err_get_participant_metadata_answers', err);
        return;
      }
      const rows = result.rows.map((r) => {
        r.is_exclusive = true;
        return r;
      });
      finishArray(res, rows);
    });
  }
  if (zinvite) {
    checkZinviteCodeValidity(zid, zinvite, doneChecking);
  } else if (suzinvite) {
    checkSuzinviteCodeValidity(zid, suzinvite, doneChecking);
  } else {
    doneChecking(false);
  }
}

function handle_GET_metadata(req, res) {
  const zid = req.p.zid;
  const zinvite = req.p.zinvite;
  const suzinvite = req.p.suzinvite;
  function doneChecking(err) {
    if (err) {
      fail(res, 403, 'polis_err_get_participant_metadata_auth', err);
      return;
    }
    async.parallel(
      [
        (callback) => {
          query_readOnly('SELECT * FROM participant_metadata_questions WHERE zid = ($1);', [zid], callback);
        },
        (callback) => {
          query_readOnly('SELECT * FROM participant_metadata_answers WHERE zid = ($1);', [zid], callback);
        },
        (callback) => {
          query_readOnly('SELECT * FROM participant_metadata_choices WHERE zid = ($1);', [zid], callback);
        }
      ],
      (err, result) => {
        if (err) {
          fail(res, 500, 'polis_err_get_participant_metadata', err);
          return;
        }
        const keys = result[0]?.rows;
        const vals = result[1]?.rows;
        const choices = result[2]?.rows;
        const o = {};
        const keyNames = {};
        const valueNames = {};
        let i;
        let k;
        let v;
        if (!keys || !keys.length) {
          res.status(200).json({});
          return;
        }
        for (i = 0; i < keys.length; i++) {
          k = keys[i];
          o[k.pmqid] = {};
          keyNames[k.pmqid] = k.key;
        }
        for (i = 0; i < vals.length; i++) {
          k = vals[i];
          v = vals[i];
          o[k.pmqid][v.pmaid] = [];
          valueNames[v.pmaid] = v.value;
        }
        for (i = 0; i < choices.length; i++) {
          o[choices[i].pmqid][choices[i].pmaid] = choices[i].pid;
        }
        res.status(200).json({
          kvp: o,
          keys: keyNames,
          values: valueNames
        });
      }
    );
  }
  if (zinvite) {
    checkZinviteCodeValidity(zid, zinvite, doneChecking);
  } else if (suzinvite) {
    checkSuzinviteCodeValidity(zid, suzinvite, doneChecking);
  } else {
    doneChecking(false);
  }
}

export {
  handle_DELETE_metadata_questions,
  handle_GET_metadata,
  handle_GET_metadata_answers,
  handle_GET_metadata_choices,
  handle_GET_metadata_questions,
  handle_POST_metadata_answers,
  handle_POST_metadata_questions
};
