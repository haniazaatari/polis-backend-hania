import _ from 'underscore';
import Config from '../../config.js';
import { isModerator } from '../../db/authorization.js';
import { getParticipantId } from '../../db/participants.js';
import {
  addXidWhitelist,
  checkMathTaskExists,
  createMathUpdateTask,
  createReportDataTask,
  getCorrelationMatrix,
  getXids,
  hasCommentSelections
} from '../../repositories/math/mathRepository.js';
import { getZidForRid } from '../../repositories/report/reportRepository.js';
import logger from '../../utils/logger.js';
import { getBidIndexToPidMapping } from '../../utils/participants.js';
import { getPca } from '../../utils/pca.js';
import { isConversationOwner } from '../zinvite/zinviteService.js';

const pcaResultsExistForZid = {};

/**
 * Processes PCA data for a conversation
 * @param {number} zid - Conversation ID
 * @param {number} math_tick - Math tick
 * @returns {Promise} - PCA data or null
 */
async function processPcaData(zid, math_tick) {
  const data = await getPca(zid, math_tick);
  if (data) {
    return data;
  }

  if (pcaResultsExistForZid[zid] === undefined) {
    const existingData = await getPca(zid, -1);
    pcaResultsExistForZid[zid] = !!existingData;
  }
  return null;
}

/**
 * Updates math for a conversation
 * @param {number} zid - Conversation ID
 * @param {number} uid - User ID
 * @param {string} math_update_type - Type of math update
 * @returns {Promise} - Resolution of the update
 */
async function updateMath(zid, uid, math_update_type) {
  const hasPermission = await isModerator(zid, uid);
  if (!hasPermission) {
    throw new Error('polis_err_math_update_permission');
  }

  const math_env = Config.mathEnv;
  await createMathUpdateTask(zid, math_update_type, math_env);
  return true;
}

/**
 * Gets correlation matrix for a report
 * @param {number} rid - Report ID
 * @param {number} math_tick - Math tick
 * @returns {Promise} - Correlation matrix data or pending status
 */
async function getCorrelationMatrixForReport(rid, math_tick) {
  const math_env = Config.mathEnv;
  const [resultRows, zid] = await Promise.all([getCorrelationMatrix(rid, math_env, math_tick), getZidForRid(rid)]);

  if (!resultRows || !resultRows.length) {
    const requestRows = await checkMathTaskExists(rid, math_env, math_tick);
    const shouldAddTask = !requestRows || !requestRows.length;

    if (shouldAddTask) {
      const hasSelections = await hasCommentSelections(rid);
      if (!hasSelections) {
        return { status: 'polis_report_needs_comment_selection' };
      }

      await createReportDataTask(rid, zid, math_tick, math_env);
    }

    return { status: 'pending' };
  }

  return resultRows[0].data;
}

/**
 * Gets bid to pid mapping for a conversation
 * @param {number} zid - Conversation ID
 * @param {number} math_tick - Math tick
 * @returns {Promise} - Bid to pid mapping
 */
async function getBidToPidMapping(zid, math_tick) {
  try {
    const doc = await getBidIndexToPidMapping(zid, math_tick);
    return { bidToPid: doc.bidToPid || [] };
  } catch (_err) {
    return null;
  }
}

/**
 * Gets XIDs for a conversation if user is owner
 * @param {number} zid - Conversation ID
 * @param {number} uid - User ID
 * @returns {Promise} - XID data
 */
async function getXidsForConversation(zid, uid) {
  const owner = await isConversationOwner(zid, uid);
  if (!owner) {
    throw new Error('polis_err_get_xids_not_authorized');
  }

  return await getXids(zid);
}

/**
 * Adds XIDs to whitelist
 * @param {Array<string>} xid_whitelist - List of XIDs to whitelist
 * @param {number} owner - Owner ID
 * @returns {Promise} - Resolution of the operation
 */
async function addXidsToWhitelist(xid_whitelist, owner) {
  await addXidWhitelist(xid_whitelist, owner);
  return true;
}

/**
 * Gets bids for a list of pids
 * @param {number} zid - Conversation ID
 * @param {number} math_tick - Math tick
 * @param {Array<number>} pids - List of participant IDs
 * @returns {Promise<Object>} - Mapping of pids to bids
 */
async function getBidsForPids(zid, math_tick, pids) {
  const [dataMapping, mathResults] = await Promise.all([
    getBidIndexToPidMapping(zid, math_tick),
    getPca(zid, math_tick)
  ]);

  const b2p = dataMapping.bidToPid || [];

  if (!mathResults || typeof mathResults !== 'object' || mathResults === null || !('asPOJO' in mathResults)) {
    logger.debug(`No PCA data available for zid ${zid}, returning empty bids mapping`);
    return _.object(
      pids,
      pids.map(() => -1)
    );
  }

  const indexToBid = mathResults.asPOJO['base-clusters'].id;

  function findBidForPid(pid) {
    let yourBidi = -1;
    for (let bidi = 0; bidi < b2p.length; bidi++) {
      const pidList = b2p[bidi];
      if (pidList.indexOf(pid) !== -1) {
        yourBidi = bidi;
        break;
      }
    }
    let yourBid = indexToBid[yourBidi];
    if (yourBidi >= 0 && _.isUndefined(yourBid)) {
      logger.error('polis_err_math_index_mapping_mismatch', { pid, b2p });
      yourBid = -1;
    }
    return yourBid;
  }

  const bids = pids.map(findBidForPid);
  return _.object(pids, bids);
}

/**
 * Gets bid for a participant
 * @param {number} zid - Conversation ID
 * @param {number} uid - User ID
 * @param {number} math_tick - Math tick
 * @returns {Promise} - Bid for the participant
 */
async function getBidForParticipant(zid, uid, math_tick) {
  const [dataMapping, pid, mathResults] = await Promise.all([
    getBidIndexToPidMapping(zid, math_tick),
    getParticipantId(zid, uid),
    getPca(zid, math_tick)
  ]);

  if (pid < 0) {
    throw new Error('polis_err_get_bid_bad_pid');
  }

  const b2p = dataMapping.bidToPid || [];
  const indexToBid = mathResults.asPOJO['base-clusters'].id;

  let yourBidi = -1;
  for (let bidi = 0; bidi < b2p.length; bidi++) {
    const pids = b2p[bidi];
    if (pids.indexOf(pid) !== -1) {
      yourBidi = bidi;
      break;
    }
  }

  let yourBid = indexToBid[yourBidi];
  if (yourBidi >= 0 && _.isUndefined(yourBid)) {
    logger.error('polis_err_math_index_mapping_mismatch', { pid, b2p });
    yourBid = -1;
  }

  return { bid: yourBid };
}

export {
  addXidsToWhitelist,
  getBidForParticipant,
  getBidsForPids,
  getBidToPidMapping,
  getCorrelationMatrixForReport,
  getXidsForConversation,
  getXids,
  processPcaData,
  updateMath
};
