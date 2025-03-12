import * as authService from '../services/auth/authService.js';
import { getGroupDemographics } from '../services/demographics/demographicsService.js';
import logger from '../utils/logger.js';
import { fail } from '../utils/responseHandlers.js';

/**
 * Handle GET request for group demographics
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleGetGroupDemographics(req, res) {
  try {
    const zid = req.p.zid;
    const rid = req.p.rid;
    const uid = req.p.uid;

    // Check if user is a moderator
    const isMod = await authService.isModerator(zid, uid);

    // Get group demographics
    const groupStats = await getGroupDemographics(zid, isMod, rid);

    res.json(groupStats);
  } catch (err) {
    if (err.message === 'polis_err_groupDemographics_auth') {
      fail(res, 403, 'polis_err_groupDemographics_auth');
    } else {
      logger.error('Error in handleGetGroupDemographics', err);
      fail(res, 500, 'polis_err_groupDemographics', err);
    }
  }
}

export { handleGetGroupDemographics };
