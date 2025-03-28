import akismetLib from 'akismet';
import AWS from 'aws-sdk';
import bluebird from 'bluebird';
import { detectLanguage } from './comment.js';
import { emailBadProblemTime } from './concerns/email.js';
import { doNotificationLoop } from './concerns/notification.js';
import Config from './config.js';
import { queryP } from './db/pg-query.js';
import { doAddDataExportTask } from './utils/common.js';
import logger from './utils/logger.js';
import { fetchAndCacheLatestPcaData } from './utils/pca.js';

const { Promise: BluebirdPromise } = bluebird;

const devMode = Config.isDevMode;
const serverUrl = Config.getServerUrl();
const shouldSendNotifications = !devMode;

const akismet = akismetLib.client({
  blog: serverUrl,
  apiKey: Config.akismetAntispamApiKey
});

AWS.config.update({ region: Config.awsRegion });

if (devMode) {
  BluebirdPromise.longStackTraces();
}

BluebirdPromise.onPossiblyUnhandledRejection((err) => {
  logger.error('onPossiblyUnhandledRejection', err);
});

akismet.verifyKey((_err, verified) => {
  if (verified) {
    logger.debug('Akismet: API key successfully verified.');
  } else {
    logger.debug('Akismet: Unable to verify API key.');
  }
});

function initializePolisHelpers() {
  if (Config.backfillCommentLangDetection) {
    queryP('select tid, txt, zid from comments where lang is null;', []).then((comments) => {
      let i = 0;
      function doNext() {
        if (i < comments.length) {
          const c = comments[i];
          i += 1;
          detectLanguage(c.txt).then((x) => {
            const firstResult = x[0];
            logger.debug(`backfill ${firstResult.language}\t\t${c.txt}`);
            queryP('update comments set lang = ($1), lang_confidence = ($2) where zid = ($3) and tid = ($4)', [
              firstResult.language,
              firstResult.confidence,
              c.zid,
              c.tid
            ]).then(() => {
              doNext();
            });
          });
        }
      }
      doNext();
    });
  }

  fetchAndCacheLatestPcaData();

  if (Config.runPeriodicExportTests && !devMode && Config.mathEnv === 'preprod') {
    const runExportTest = () => {
      const math_env = 'prod';
      const email = Config.adminEmailDataExportTest;
      const zid = 12480;
      const atDate = Date.now();
      const format = 'csv';
      const task_bucket = Math.abs((Math.random() * 999999999999) >> 0);
      doAddDataExportTask(math_env, email, zid, atDate, format, task_bucket).then(() => {
        setTimeout(
          () => {
            queryP("select * from worker_tasks where task_type = 'generate_export_data' and task_bucket = ($1);", [
              task_bucket
            ]).then((rows) => {
              const ok = rows?.length;
              let newOk;
              if (ok) {
                newOk = rows[0].finished_time > 0;
              }
              if (ok && newOk) {
                logger.info('runExportTest success');
              } else {
                logger.error('runExportTest failed');
                emailBadProblemTime("Math export didn't finish.");
              }
            });
          },
          10 * 60 * 1000
        );
      });
    };
    setInterval(runExportTest, 6 * 60 * 60 * 1000);
  }

  if (shouldSendNotifications) {
    doNotificationLoop();
  }

  logger.debug('end initializePolisHelpers');

  return;
}

export { initializePolisHelpers };
