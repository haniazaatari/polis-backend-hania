import { getCommentsWithoutLanguage, updateCommentLanguage } from '../../db/comments.js';
import logger from '../../utils/logger.js';
import { detectLanguage } from '../translation/translationService.js';

/**
 * Runs a backfill process for comments that don't have language detection
 * This updates comments table with language and confidence values
 * @returns {Promise<void>}
 */
async function backfillCommentLanguageDetection() {
  const comments = await getCommentsWithoutLanguage();
  let i = 0;

  async function doNext() {
    if (i < comments.length) {
      const c = comments[i];
      i += 1;
      const x = await detectLanguage(c.txt);
      const firstResult = x[0];
      logger.debug(`backfill ${firstResult.language}\t\t${c.txt}`);
      await updateCommentLanguage(firstResult.language, firstResult.confidence, c.zid, c.tid);
      await doNext();
    } else {
      logger.debug('Finished comment language detection backfill');
    }
  }

  await doNext();
}

export { backfillCommentLanguageDetection };
