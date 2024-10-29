import { query as pgQuery } from '../db/pg-query';
import Utils from '../utils/common';
import fail from '../utils/fail';

function getZidForAnswer(pmaid, callback) {
  pgQuery('SELECT zid FROM participant_metadata_answers WHERE pmaid = ($1);', [pmaid], function (err, result) {
    if (err) {
      callback(err);
      return;
    }
    if (!result.rows || !result.rows.length) {
      callback('polis_err_zid_missing_for_answer');
      return;
    }
    callback(null, result.rows[0].zid);
  });
}

function deleteMetadataAnswer(pmaid, callback) {
  pgQuery('update participant_metadata_answers set alive = FALSE where pmaid = ($1);', [pmaid], function (err) {
    if (err) {
      callback(err);
      return;
    }
    callback(null);
  });
}

function handle_DELETE_metadata_answers(req, res) {
  let uid = req.p.uid;
  let pmaid = req.p.pmaid;

  getZidForAnswer(pmaid, function (err, zid) {
    if (err) {
      fail(res, 500, 'polis_err_delete_participant_metadata_answers_zid', err);
      return;
    }
    Utils.isConversationOwner(zid, uid, function (err) {
      if (err) {
        fail(res, 403, 'polis_err_delete_participant_metadata_answers_auth', err);
        return;
      }

      deleteMetadataAnswer(pmaid, function (err) {
        if (err) {
          fail(res, 500, 'polis_err_delete_participant_metadata_answers', err);
          return;
        }
        res.send(200);
      });
    });
  });
}

export default handle_DELETE_metadata_answers;
