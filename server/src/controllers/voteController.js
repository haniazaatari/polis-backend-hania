import { COOKIES } from '../services/auth/constants.js';
import { getPermanentCookieAndEnsureItIsSet } from '../services/auth/cookieService.js';
import {
  doFamousQuery,
  getVotesForMe,
  getVotesForSingleParticipant,
  processVote
} from '../services/vote/voteService.js';
import { fail, finishArray, finishOne } from '../utils/responseHandlers.js';

/**
 * Handle GET /votes
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const handleGetVotes = async (req, res) => {
  try {
    const votes = await getVotesForSingleParticipant(req.p);
    finishArray(res, votes);
  } catch (err) {
    fail(res, 500, 'polis_err_votes_get', err);
  }
};

/**
 * Handle GET /votes/me
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const handleGetVotesForMe = async (req, res) => {
  try {
    const votes = await getVotesForMe(req.p.zid, req.p.uid);
    finishArray(res, votes);
  } catch (err) {
    fail(res, 500, 'polis_err_get_votes_by_me', err);
  }
};

/**
 * Handle GET /votes/famous
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const handleGetFamousVotes = async (req, res) => {
  try {
    const data = await doFamousQuery(req.p);
    res.status(200).json(data);
  } catch (err) {
    fail(res, 500, 'polis_err_famous_proj_get', err);
  }
};

/**
 * Handle POST /votes
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const handleCreateVote = async (req, res) => {
  const uid = req.p.uid;
  const zid = req.p.zid;
  const pid = req.p.pid;
  const tid = req.p.tid;
  const lang = req.p.lang;
  const token = req.cookies[COOKIES.TOKEN];
  const apiToken = req?.headers?.authorization || '';
  const xPolisHeaderToken = req?.headers?.['x-polis'];

  // Check authentication
  if (!uid && !token && !apiToken && !xPolisHeaderToken) {
    return fail(res, 403, 'polis_err_vote_noauth');
  }

  // Validate required parameters
  if (!zid) {
    return fail(res, 400, 'polis_err_missing_zid');
  }

  if (tid === undefined || tid === null) {
    return fail(res, 400, 'polis_err_missing_tid');
  }

  // We allow pid to be 0 (valid participant ID)
  if (pid === undefined || pid === null || pid < 0) {
    return fail(res, 400, 'polis_err_missing_pid');
  }

  try {
    // Get permanent cookie
    const permanent_cookie = getPermanentCookieAndEnsureItIsSet(req, res);

    // Process the vote
    const voteParams = {
      uid,
      pid,
      zid,
      tid,
      xid: req.p.xid,
      vote: req.p.vote,
      weight: req.p.weight,
      high_priority: req.p.high_priority,
      starred: req.p.starred,
      lang
    };

    const result = await processVote(voteParams, req, permanent_cookie);
    finishOne(res, result);
  } catch (err) {
    // Handle both string errors and Error objects
    const errorMessage = err?.message || err;

    if (errorMessage === 'polis_err_vote_duplicate') {
      fail(res, 406, 'polis_err_vote_duplicate', err);
    } else if (errorMessage === 'polis_err_conversation_is_closed') {
      fail(res, 403, 'polis_err_conversation_is_closed', err);
    } else if (errorMessage === 'polis_err_post_votes_social_needed') {
      fail(res, 403, 'polis_err_post_votes_social_needed', err);
    } else if (errorMessage === 'polis_err_xid_not_whitelisted') {
      fail(res, 403, 'polis_err_xid_not_whitelisted', err);
    } else if (errorMessage === 'polis_err_param_pid_invalid') {
      fail(res, 400, 'polis_err_param_pid_invalid', err);
    } else {
      fail(res, 500, 'polis_err_vote', err);
    }
  }
};
