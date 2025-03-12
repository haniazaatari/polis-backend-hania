import Config from '../../config.js';
import { queryP } from '../../db/pg-query.js';
import logger from '../../utils/logger.js';
import { detectLanguage } from '../translation/translationService.js';

/**
 * Runs a backfill process for comments that don't have language detection
 * This updates comments table with language and confidence values
 */
export function backfillCommentLanguageDetection() {
  if (!Config.backfillCommentLangDetection) {
    return;
  }

  logger.debug('Starting comment language detection backfill');

  return queryP('select tid, txt, zid from comments where lang is null;', []).then((comments) => {
    let i = 0;
    function doNext() {
      if (i < comments.length) {
        const c = comments[i];
        i += 1;
        detectLanguage(c.txt).then((x) => {
          const firstResult = x[0];
          logger.debug(`backfill ${firstResult.language}\t\t${c.txt}`);
          return queryP('update comments set lang = ($1), lang_confidence = ($2) where zid = ($3) and tid = ($4)', [
            firstResult.language,
            firstResult.confidence,
            c.zid,
            c.tid
          ]).then(() => {
            doNext();
          });
        });
      } else {
        logger.debug('Finished comment language detection backfill');
      }
    }
    doNext();
  });
}
