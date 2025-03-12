import AWS from 'aws-sdk';
import Config from '../config.js';
import User from '../user.js';
import { doAddDataExportTask } from '../utils/common.js';
import fail from '../utils/fail.js';
AWS.config.update({ region: Config.awsRegion });
const s3Client = new AWS.S3({ apiVersion: '2006-03-01' });
function handle_GET_dataExport(req, res) {
  const getUserInfoForUid2 = User.getUserInfoForUid2;
  getUserInfoForUid2(req.p.uid)
    .then((user) => {
      return doAddDataExportTask(
        Config.mathEnv,
        user.email,
        req.p.zid,
        req.p.unixTimestamp * 1000,
        req.p.format,
        Math.abs((Math.random() * 999999999999) >> 0)
      )
        .then(() => {
          res.json({});
        })
        .catch((err) => {
          fail(res, 500, 'polis_err_data_export123', err);
        });
    })
    .catch((err) => {
      fail(res, 500, 'polis_err_data_export123b', err);
    });
}
function handle_GET_dataExport_results(req, res) {
  const url = s3Client.getSignedUrl('getObject', {
    Bucket: 'polis-datadump',
    Key: `${Config.mathEnv}/${req.p.filename}`,
    Expires: 60 * 60 * 24 * 7
  });
  res.redirect(url);
}
export { handle_GET_dataExport, handle_GET_dataExport_results };
