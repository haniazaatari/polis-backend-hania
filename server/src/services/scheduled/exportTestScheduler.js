import Config from '../../config.js';
import { queryP } from '../../db/pg-query.js';
import { emailBadProblemTime } from '../../email/senders.js';
import { doAddDataExportTask } from '../../utils/common.js';
import logger from '../../utils/logger.js';

/**
 * Schedules and runs export tests to verify the data export functionality is working
 */
export function scheduleExportTests() {
  const devMode = Config.isDevMode;

  if (!Config.runPeriodicExportTests || devMode || Config.mathEnv !== 'preprod') {
    return;
  }

  logger.debug('Scheduling export test runner');

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

  // Run the test every 6 hours
  setInterval(runExportTest, 6 * 60 * 60 * 1000);

  logger.debug('Export test scheduler initialized');
}
