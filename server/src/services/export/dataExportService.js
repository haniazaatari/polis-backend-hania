import AWS from 'aws-sdk';
import Config from '../../config.js';
import { doAddDataExportTask } from '../../utils/common.js';
import { getUserInfoForUid2 } from '../user/userService.js';

// Configure AWS
AWS.config.update({ region: Config.awsRegion });
const s3Client = new AWS.S3({ apiVersion: '2006-03-01' });

/**
 * Request a data export for a conversation
 * @param {number} uid - User ID
 * @param {number} zid - Conversation ID
 * @param {number} unixTimestamp - Unix timestamp
 * @param {string} format - Export format
 * @returns {Promise<void>} - Promise that resolves when the export task is added
 */
async function requestDataExport(uid, zid, unixTimestamp, format) {
  const user = await getUserInfoForUid2(uid);
  const randomId = Math.abs((Math.random() * 999999999999) >> 0);

  return doAddDataExportTask(Config.mathEnv, user.email, zid, unixTimestamp * 1000, format, randomId);
}

/**
 * Get a signed URL for a data export file
 * @param {string} filename - The filename of the export
 * @returns {string} - Signed URL for the export file
 */
function getDataExportUrl(filename) {
  return s3Client.getSignedUrl('getObject', {
    Bucket: 'polis-datadump',
    Key: `${Config.mathEnv}/${filename}`,
    Expires: 60 * 60 * 24 * 7 // 7 days
  });
}

export { requestDataExport, getDataExportUrl };
