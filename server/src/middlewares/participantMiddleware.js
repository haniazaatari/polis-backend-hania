import { getParticipantId } from '../repositories/participant/participantRepository.js';
import logger from '../utils/logger.js';

/**
 * Express middleware to get participant ID for a user
 * This is a direct port of the original getPidForParticipant function
 *
 * @param {Function} assigner - Function to assign the pid to the request (typically assignToP)
 * @param {Object} _cache - Optional cache object (not used in current implementation)
 * @returns {Function} - Express middleware
 */
function getParticipantIdMiddleware(assigner, _cache) {
  return (req, _res, next) => {
    const zid = req.p.zid;
    const uid = req.p.uid;

    function finish(pid) {
      assigner(req, 'pid', pid);
      next();
    }

    getParticipantId(zid, uid)
      .then((pid) => {
        if (pid === -1) {
          const msg = 'polis_err_get_pid_for_participant_missing';
          logger.error(msg, {
            zid,
            uid,
            p: req.p
          });
          return next(msg);
        }
        finish(pid);
      })
      .catch((err) => {
        logger.error('polis_err_get_pid_for_participant', err);
        next(err);
      });
  };
}

export { getParticipantIdMiddleware };
