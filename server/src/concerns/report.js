import _ from 'underscore';
import { generateTokenP } from '../auth/password.js';
import { queryP } from '../db/pg-query.js';
import { sql_reports } from '../db/sql.js';
import { isModerator } from '../utils/common.js';
import { fail } from '../utils/fail.js';
function createReport(zid) {
  return generateTokenP(20, false).then((report_id) => {
    report_id = `r${report_id}`;
    return queryP('insert into reports (zid, report_id) values ($1, $2);', [zid, report_id]);
  });
}

function handle_POST_reports(req, res) {
  const zid = req.p.zid;
  const uid = req.p.uid;
  return isModerator(zid, uid)
    .then((isMod, err) => {
      if (!isMod) {
        return fail(res, 403, 'polis_err_post_reports_permissions', err);
      }
      return createReport(zid).then(() => {
        res.json({});
      });
    })
    .catch((err) => {
      fail(res, 500, 'polis_err_post_reports_misc', err);
    });
}

function handle_PUT_reports(req, res) {
  const rid = req.p.rid;
  const uid = req.p.uid;
  const zid = req.p.zid;
  return isModerator(zid, uid)
    .then((isMod, err) => {
      if (!isMod) {
        return fail(res, 403, 'polis_err_put_reports_permissions', err);
      }
      const fields = {
        modified: 'now_as_millis()'
      };
      sql_reports.columns
        .map((c) => {
          return c.name;
        })
        .filter((name) => {
          return name.startsWith('label_');
        })
        .forEach((name) => {
          if (!_.isUndefined(req.p[name])) {
            fields[name] = req.p[name];
          }
        });
      if (!_.isUndefined(req.p.report_name)) {
        fields.report_name = req.p.report_name;
      }
      const q = sql_reports.update(fields).where(sql_reports.rid.equals(rid));
      let query = q.toString();
      query = query.replace("'now_as_millis()'", 'now_as_millis()');
      return queryP(query, []).then((_result) => {
        res.json({});
      });
    })
    .catch((err) => {
      fail(res, 500, 'polis_err_post_reports_misc', err);
    });
}

function handle_GET_reports(req, res) {
  const zid = req.p.zid;
  const rid = req.p.rid;
  const uid = req.p.uid;
  let reportsPromise = null;
  if (rid) {
    if (zid) {
      reportsPromise = Promise.reject('polis_err_get_reports_should_not_specify_both_report_id_and_conversation_id');
    } else {
      reportsPromise = queryP('select * from reports where rid = ($1);', [rid]);
    }
  } else if (zid) {
    reportsPromise = isModerator(zid, uid).then((doesOwnConversation) => {
      if (!doesOwnConversation) {
        throw 'polis_err_permissions';
      }
      return queryP('select * from reports where zid = ($1);', [zid]);
    });
  } else {
    reportsPromise = queryP('select * from reports where zid in (select zid from conversations where owner = ($1));', [
      uid
    ]);
  }
  reportsPromise
    .then((reports) => {
      const zids = [];
      reports = reports.map((report) => {
        zids.push(report.zid);
        report.rid = undefined;
        return report;
      });
      if (zids.length === 0) {
        return res.json(reports);
      }
      return queryP(`select * from zinvites where zid in (${zids.join(',')});`, []).then((zinvite_entries) => {
        const zidToZinvite = _.indexBy(zinvite_entries, 'zid');
        reports = reports.map((report) => {
          report.conversation_id = zidToZinvite[report.zid || '']?.zinvite;
          report.zid = undefined;
          return report;
        });
        res.json(reports);
      });
    })
    .catch((err) => {
      if (err === 'polis_err_permissions') {
        fail(res, 403, 'polis_err_permissions');
      } else if (err === 'polis_err_get_reports_should_not_specify_both_report_id_and_conversation_id') {
        fail(res, 404, 'polis_err_get_reports_should_not_specify_both_report_id_and_conversation_id');
      } else {
        fail(res, 500, 'polis_err_get_reports_misc', err);
      }
    });
}

export { handle_POST_reports, handle_PUT_reports, handle_GET_reports };
