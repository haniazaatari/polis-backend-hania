/**
 * XID Service
 * Handles business logic related to external IDs (XIDs)
 */

import * as xidRepository from '../../repositories/xid/xidRepository.js';
import logger from '../../utils/logger.js';

/**
 * Create an XID record by ZID with business logic (including whitelist validation)
 * @param {number} zid - Conversation ID
 * @param {number} uid - User ID
 * @param {string} xid - External ID
 * @param {string|null} x_profile_image_url - Profile image URL
 * @param {string|null} x_name - Name
 * @param {string|null} x_email - Email
 * @param {boolean} returnRecord - Whether to return the created record
 * @returns {Promise<Array|void>} - Created XID record if returnRecord is true
 */
async function createXidRecordByZid(zid, uid, xid, x_profile_image_url, x_name, x_email, returnRecord = false) {
  try {
    // Import the conversation service to avoid circular dependencies
    const { default: conversationService } = await import('../conversation/conversationService.js');

    // Get conversation info to check whitelist
    const conv = await conversationService.getConversationInfo(zid);

    // Check if XID is whitelisted if required
    if (conv?.use_xid_whitelist) {
      const isWhitelisted = await xidRepository.isXidWhitelisted(conv.owner, xid);
      if (!isWhitelisted) {
        throw new Error('polis_err_xid_not_whitelisted_2');
      }
    }

    // Create XID record
    return await xidRepository.createXidRecordByZid(zid, uid, xid, x_profile_image_url, x_name, x_email, returnRecord);
  } catch (error) {
    logger.error('Error creating XID record by ZID', error);
    throw error;
  }
}

export { createXidRecordByZid };
