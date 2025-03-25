/**
 * Participant Service
 * Handles business logic for participants
 */
import Config from '../../config.js';
import * as db from '../../db/index.js';
import { tryToJoinConversation, userHasAnsweredZeQuestions } from '../../repositories/participantRepository.js';
import { COOKIES } from '../../services/auth/constants.js';
import logger from '../../utils/logger.js';
import { fail } from '../../utils/responseHandlers.js';
import { startSessionAndAddCookies } from '../auth/sessionService.js';
import { getConversationInfo } from '../conversation/conversationService.js';
import { deleteSuzinvite, getSUZinviteInfo } from '../inviteService.js';
import { createDummyUser, getUserInfoForUid2 } from '../userService.js';
import { encrypt } from '../utils/encryptionService.js';

/**
 * Get a participant by conversation ID and user ID
 * @param {number} zid - Conversation ID
 * @param {number} uid - User ID
 * @returns {Promise<Object|null>} - Participant object or null if not found
 */
async function getParticipant(zid, uid) {
  return db.getParticipantByUid(zid, uid);
}

/**
 * Join a conversation
 * @param {number} zid - Conversation ID
 * @param {number} uid - User ID
 * @param {Object} info - Additional information
 * @param {Object} answers - Answers to participant metadata questions
 * @returns {Promise<Object>} - Participant object
 */
async function joinConversation(zid, uid, info, answers) {
  try {
    // Try to get participant ID first
    const existingPid = await db.getParticipantId(zid, uid);

    // If participant already exists, return early
    if (existingPid >= 0) {
      return { pid: existingPid };
    }

    // If not, try to join with retry logic
    let result;
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      try {
        result = await tryToJoinConversation(zid, uid, info, answers);
        break; // Success, exit the loop
      } catch (err) {
        attempts++;
        if (attempts >= maxAttempts) {
          throw err; // Rethrow if we've exhausted all attempts
        }
        // Small delay before retry
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    return result;
  } catch (err) {
    logger.error('Error joining conversation', { error: err, zid, uid });
    throw err;
  }
}

/**
 * Add a participant and their metadata to a conversation
 * @param {number} zid - Conversation ID
 * @param {number} uid - User ID
 * @param {Object} req - Express request object
 * @param {string} permanent_cookie - Permanent cookie
 * @returns {Promise<Object>} - The inserted participant
 */
async function addParticipantAndMetadata(zid, uid, req, permanent_cookie) {
  try {
    const info = {};

    // Extract parent URL and referrer
    const parent_url = req?.cookies?.[COOKIES.PARENT_URL] || req?.p?.parent_url;
    const referer = req?.cookies[COOKIES.PARENT_REFERRER] || req?.headers?.referer || req?.headers?.referrer;

    if (parent_url) {
      info.parent_url = parent_url;
    }

    if (referer) {
      info.referrer = referer;
    }

    // Handle IP address for web server
    if (Config.applicationName === 'PolisWebServer') {
      const x_forwarded_for = req?.headers?.['x-forwarded-for'];
      let ip = null;

      if (x_forwarded_for) {
        let ips = x_forwarded_for;
        ips = ips?.split(', ');
        ip = ips.length && ips[0];
        info.encrypted_ip_address = encrypt(ip);
        info.encrypted_x_forwarded_for = encrypt(x_forwarded_for);
      }
    }

    // Add permanent cookie and origin
    if (permanent_cookie) {
      info.permanent_cookie = permanent_cookie;
    }

    if (req?.headers?.origin) {
      info.origin = req?.headers?.origin;
    }

    // First check if participant already exists
    try {
      const existingParticipant = await getParticipant(zid, uid);
      if (existingParticipant && existingParticipant.length > 0) {
        logger.debug('Participant already exists, using existing participant', { zid, uid });

        // Add extended info if needed
        if (Object.keys(info).length > 0) {
          await db.updateExtendedParticipantInfo(zid, uid, info);
        }

        return existingParticipant;
      }
    } catch {
      // If the participant doesn't exist, continue with creation
      logger.debug('Existing participant not found, creating new one', { zid, uid });
    }

    // Create participant and add extended info
    const [participant] = await db.addParticipant(zid, uid);

    // Add extended info if needed
    if (Object.keys(info).length > 0) {
      await db.updateExtendedParticipantInfo(zid, uid, info);
    }

    return participant;
  } catch (error) {
    // Special handling for unique constraint violation
    if (error.code === '23505' && error.constraint === 'participants_zid_uid_key') {
      logger.debug('Participant already exists (caught unique constraint)', { zid, uid });
      try {
        // Retry getting the existing participant
        const existingParticipant = await getParticipant(zid, uid);
        return existingParticipant;
      } catch (getErr) {
        logger.error('Error getting existing participant after constraint violation', { error: getErr, zid, uid });
        throw error; // Re-throw the original error if we can't get the existing participant
      }
    }

    logger.error('Error adding participant and metadata', { error, zid, uid });
    throw error;
  }
}

/**
 * Join a conversation with a ZID or single-use invite
 * @param {Object} options - Options object
 * @param {Object} [options.answers] - Answers to participant metadata questions
 * @param {boolean} [options.existingAuth] - Whether the user is already authenticated
 * @param {string} [options.suzinvite] - Single-use zid invite token
 * @param {string} [options.permanentCookieToken] - Permanent cookie token
 * @param {number} [options.uid] - User ID
 * @param {number} [options.zid] - Conversation ID
 * @param {string} [options.referrer] - Referrer URL
 * @param {string} [options.parent_url] - Parent URL
 * @param {string} [options.xid] - External ID
 * @returns {Promise<Object>} - Object containing uid, pid, zid, and other info
 */
async function joinWithZidOrSuzinvite(options) {
  try {
    // Step 1: Get conversation info from suzinvite or zid
    let o = { ...options };

    if (o.suzinvite) {
      const suzinviteInfo = await getSUZinviteInfo(o.suzinvite);
      o = { ...o, ...suzinviteInfo };
    } else if (!o.zid) {
      throw new Error('polis_err_missing_invite');
    }

    // Step 2: Get conversation info
    logger.info('joinWithZidOrSuzinvite convinfo begin');
    const conv = await getConversationInfo(o.zid);
    logger.info('joinWithZidOrSuzinvite convinfo done');
    o.conv = conv;

    // Step 3: Get user info if uid is provided
    logger.info('joinWithZidOrSuzinvite userinfo begin');
    if (o.uid) {
      logger.info('joinWithZidOrSuzinvite userinfo with uid');
      const user = await getUserInfoForUid2(o.uid);
      logger.info('joinWithZidOrSuzinvite userinfo done');
      o.user = user;
    } else {
      logger.info('joinWithZidOrSuzinvite userinfo no uid');
    }

    // Step 4: Create dummy user if no uid is provided
    if (!o.uid) {
      const uid = await createDummyUser();
      o.uid = uid;
    }

    // Step 5: Check if user has answered required questions
    await userHasAnsweredZeQuestions(o.zid, o.answers);

    // Step 6: Join the conversation
    const info = {};
    if (o.referrer) {
      info.referrer = o.referrer;
    }
    if (o.parent_url) {
      info.parent_url = o.parent_url;
    }

    const ptpt = await joinConversation(o.zid, o.uid, info, o.answers);
    o = { ...o, ...ptpt };

    // Step 7: Handle XID if provided
    if (o.xid) {
      const exists = await db.xidExists(o.xid, o.conv.org_id, o.uid);

      if (!exists) {
        const shouldCreateXidEntry = o.conv.use_xid_whitelist ? await db.isXidWhitelisted(o.conv.owner, o.xid) : true;

        if (shouldCreateXidEntry) {
          await db.createXidEntry(o.xid, o.conv.org_id, o.uid);
        } else {
          throw new Error('polis_err_xid_not_whitelisted');
        }
      }
    }

    // Step 8: Delete suzinvite if used
    if (o.suzinvite) {
      await deleteSuzinvite(o.suzinvite);
    }

    return {
      uid: o.uid,
      pid: o.pid,
      zid: o.zid,
      existingAuth: options.existingAuth,
      permanentCookieToken: options.permanentCookieToken
    };
  } catch (error) {
    logger.error('Error in joinWithZidOrSuzinvite', { error });
    throw error;
  }
}

/**
 * Handle POST request to join with invite
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
async function handlePostJoinWithInvite(req, res) {
  try {
    const result = await joinWithZidOrSuzinvite({
      answers: req.p.answers,
      existingAuth: !!req.p.uid,
      suzinvite: req.p.suzinvite,
      permanentCookieToken: req.p.permanentCookieToken,
      uid: req.p.uid,
      zid: req.p.zid,
      referrer: req.p.referrer,
      parent_url: req.p.parent_url
    });

    const uid = result.uid;
    logger.info(`startSessionAndAddCookies ${uid} existing ${result.existingAuth}`);

    // Start session if user is not already authenticated
    if (!result.existingAuth) {
      await startSessionAndAddCookies(uid, res);
    }

    // Record permanent cookie zid join if provided
    if (result.permanentCookieToken) {
      try {
        await db.recordPermanentCookieZidJoin(result.permanentCookieToken, result.zid);
      } catch (error) {
        logger.error('Error recording permanent cookie zid join', { error });
        // Continue even if this fails
      }
    }

    // Send response
    res.status(200).json({
      pid: result.pid,
      uid: req.p.uid
    });
  } catch (err) {
    if (err?.message?.match(/polis_err_need_full_user/)) {
      fail(res, 403, err.message, err);
    } else if (err?.message) {
      fail(res, 500, err.message, err);
    } else if (err) {
      fail(res, 500, 'polis_err_joinWithZidOrSuzinvite', err);
    } else {
      fail(res, 500, 'polis_err_joinWithZidOrSuzinvite');
    }
  }
}

/**
 * Query participants by metadata
 * @param {number} zid - Conversation ID
 * @param {Array<number>} pmaids - Participant metadata answer IDs
 * @returns {Promise<Array<number>>} - Array of participant IDs
 */
async function queryParticipantsByMetadata(zid, pmaids) {
  // Simple passthrough to DB module since this is a complex but single-purpose query
  // No additional business logic needed at service layer
  return db.queryParticipantsByMetadata(zid, pmaids);
}

/**
 * Update participant extended info
 * @param {number} zid - Conversation ID
 * @param {number} uid - User ID
 * @param {Object} fields - Fields to update
 * @returns {Promise<Object>} - Update result
 */
async function updateParticipantExtendedInfo(zid, uid, fields) {
  // Simple CRUD operation - directly use DB module
  // Bypassing repository layer as this is a simple single-table update
  return db.updateExtendedParticipantInfo(zid, uid, fields);
}

export {
  getParticipant,
  joinConversation,
  addParticipantAndMetadata,
  joinWithZidOrSuzinvite,
  handlePostJoinWithInvite,
  queryParticipantsByMetadata,
  updateParticipantExtendedInfo
};
