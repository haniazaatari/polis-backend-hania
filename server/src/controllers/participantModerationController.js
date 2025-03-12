import * as participantModerationService from '../services/participant/participantModerationService.js';
import logger from '../utils/logger.js';
import { fail } from '../utils/responseHandlers.js';

/**
 * Handle GET request to retrieve participants of interest (with moderation status)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleGetParticipantsOfInterest(req, res) {
  try {
    const zid = req.p.zid;
    const mod = req.p.mod;
    const uid = req.p.uid;
    const conversationId = req.p.conversation_id;

    const participants = await participantModerationService.getParticipantsWithModerationStatus(
      zid,
      mod,
      uid,
      conversationId
    );

    res.status(200).json(participants);
  } catch (err) {
    logger.error('Error handling get participants of interest request', err);
    fail(res, 500, 'polis_err_ptptoi_misc', err);
  }
}

/**
 * Handle PUT request to update participant moderation status
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleUpdateParticipantModerationStatus(req, res) {
  try {
    const zid = req.p.zid;
    const uid = req.p.uid;
    const pid = req.p.pid;
    const mod = req.p.mod;

    await participantModerationService.updateParticipantModerationStatus(zid, uid, pid, mod);

    res.status(200).json({});
  } catch (err) {
    logger.error('Error handling update participant moderation status request', err);
    fail(res, 500, 'polis_err_ptptoi_misc_234', err);
  }
}

export { handleGetParticipantsOfInterest, handleUpdateParticipantModerationStatus };
