/**
 * Participant Controller
 * Handles HTTP requests related to participants
 */
import _ from 'underscore';
import { updateLastInteractionTimeForConversation } from '../db/conversationUpdates.js';
import { getConversationInfo } from '../db/conversations.js';
import { queryP } from '../db/pg-query.js';
import { sql_participants_extended } from '../db/sql.js';
import { addExtendedParticipantInfo } from '../repositories/participant/participantRepository.js';
import { userHasAnsweredZeQuestions } from '../repositories/participant/participantRepository.js';
import { COOKIES } from '../services/auth/constants.js';
import { clearCookie } from '../services/auth/cookieService.js';
import {
  getParticipant,
  joinConversation,
  queryParticipantsByMetadata
} from '../services/participant/participantService.js';
import logger from '../utils/logger.js';
import { isOwnerOrParticipant } from '../utils/participants.js';
import { fail } from '../utils/responseHandlers.js';

/**
 * Handle GET request to retrieve a participant
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleGetParticipants(req, res) {
  try {
    const uid = req.p.uid;
    const zid = req.p.zid;

    const ptpt = await getParticipant(zid, uid);
    res.status(200).json(ptpt);
  } catch (err) {
    logger.error('Error getting participant', { error: err, zid: req.p.zid, uid: req.p.uid });
    fail(res, 500, 'polis_err_get_participant', err);
  }
}

/**
 * Handle POST request to create or retrieve a participant
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handlePostParticipants(req, res) {
  const zid = req.p.zid;
  const uid = req.p.uid;
  const answers = req.p.answers;
  const info = {};

  // Get parent URL and referrer from cookies or request parameters
  const parent_url = req.cookies?.[COOKIES.PARENT_URL] || req.p.parent_url;
  const referrer = req.cookies?.[COOKIES.PARENT_REFERRER] || req.p.referrer;

  if (parent_url) {
    info.parent_url = parent_url;
  }

  if (referrer) {
    info.referrer = referrer;
  }

  try {
    // Check if participant already exists
    const existingPtpt = await getParticipant(zid, uid);

    if (existingPtpt) {
      // If participant exists, update extended info and return
      if (Object.keys(info).length > 0) {
        await addExtendedParticipantInfo(zid, uid, info);
      }

      // Clear cookies and update last interaction time
      clearCookie(req, res, COOKIES.PARENT_URL);
      clearCookie(req, res, COOKIES.PARENT_REFERRER);

      setTimeout(() => {
        updateLastInteractionTimeForConversation(zid, uid);
      }, 0);

      return res.status(200).json(existingPtpt);
    }

    // If participant doesn't exist, check conversation and join
    await getConversationInfo(zid);

    // Check if user has answered required questions
    await userHasAnsweredZeQuestions(zid, answers);

    // Join the conversation
    const ptpt = await joinConversation(zid, uid, info, answers);

    // Clear cookies and update last interaction time
    clearCookie(req, res, COOKIES.PARENT_URL);
    clearCookie(req, res, COOKIES.PARENT_REFERRER);

    setTimeout(() => {
      updateLastInteractionTimeForConversation(zid, uid);
    }, 0);

    res.status(200).json(ptpt);
  } catch (err) {
    if (err?.message?.startsWith('polis_err_metadata_not_chosen')) {
      fail(res, 400, err.message, err);
    } else {
      fail(res, 500, 'polis_err_post_participants', err);
    }
  }
}

/**
 * Handle PUT request to update participant extended info
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handlePutParticipantsExtended(req, res) {
  try {
    const zid = req.p.zid;
    const uid = req.p.uid;
    const fields = {};

    if (!_.isUndefined(req.p.show_translation_activated)) {
      fields.show_translation_activated = req.p.show_translation_activated;
    }

    // If no fields to update, return early
    if (Object.keys(fields).length === 0) {
      return res.json({ status: 'ok' });
    }

    const q = sql_participants_extended
      .update(fields)
      .where(sql_participants_extended.zid.equals(zid))
      .and(sql_participants_extended.uid.equals(uid));

    const result = await queryP(q.toString(), []);
    res.json(result);
  } catch (err) {
    fail(res, 500, 'polis_err_put_participants_extended', err);
  }
}

/**
 * Handle POST /participants/metadata/query
 * Query participants by metadata
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleQueryParticipantsByMetadata(req, res) {
  try {
    const uid = req.p.uid;
    const zid = req.p.zid;
    const pmaids = req.p.pmaids;

    // If no metadata IDs provided, return empty array
    if (!pmaids.length) {
      return res.status(200).json([]);
    }

    // Check if user is owner or participant
    await isOwnerOrParticipant(zid, uid);

    // Query participants by metadata
    const participantIds = await queryParticipantsByMetadata(zid, pmaids);

    res.status(200).json(participantIds);
  } catch (err) {
    fail(res, 500, 'polis_err_metadata_query', err);
  }
}

export {
  handleGetParticipants,
  handlePostParticipants,
  handlePutParticipantsExtended,
  handleQueryParticipantsByMetadata
};
