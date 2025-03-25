import _ from 'underscore';
import Config from '../../config.js';
import * as db from '../../db/index.js';
import { sendCreatedLinkToEmail } from '../../email/specialized.js';
import { ifDefinedFirstElseSecond } from '../../utils/common.js';
import { DEFAULTS } from '../../utils/constants.js';
import logger from '../../utils/logger.js';
import { getUpvotesForUser } from '../upvote/upvoteService.js';
import * as urlService from '../url/urlService.js';
import { getUserInfoForUid2 } from '../user/userService.js';
import { generateAndRegisterZinvite, getZinvite } from '../zinvite/zinviteService.js';

const serverUrl = Config.getServerNameWithProtocol();

/**
 * Get conversation information by ZID
 * @param {number} zid - Conversation ID
 * @returns {Promise<Object>} - Conversation information
 */
async function getConversationInfo(zid) {
  try {
    return await db.getConversationByZid(zid);
  } catch (error) {
    logger.error('Error getting conversation info', error);
    throw error;
  }
}

/**
 * Get conversation information by conversation ID (zinvite)
 * @param {string} conversationId - Conversation ID (zinvite)
 * @returns {Promise<Object>} - Conversation information
 */
async function getConversationInfoByConversationId(conversationId) {
  try {
    return await db.getConversationByConversationId(conversationId);
  } catch (error) {
    logger.error('Error getting conversation info by conversation ID', error);
    throw error;
  }
}

/**
 * Get ZID from conversation ID (zinvite)
 * @param {string} conversationId - Conversation ID (zinvite)
 * @returns {Promise<number>} - ZID
 */
async function getZidFromConversationId(conversationId) {
  try {
    return await db.getZidFromConversationId(conversationId);
  } catch (error) {
    logger.error('Error getting ZID from conversation ID', error);
    throw error;
  }
}

/**
 * Verify metadata answers exist for each question
 * @param {number} zid - Conversation ID
 * @returns {Promise<void>}
 */
async function verifyMetadataAnswersExistForEachQuestion(zid) {
  return db.verifyMetadataAnswersExistForEachQuestion(zid);
}

/**
 * Update a conversation
 * @param {number} zid - Conversation ID
 * @param {Object} fields - Fields to update
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} - Updated conversation
 */
async function updateConversation(zid, fields, options = {}) {
  // Verify metadata if needed
  if (options.verifyMeta) {
    await verifyMetadataAnswersExistForEachQuestion(zid);
  }

  // Update conversation in database
  const updatedConversation = await db.updateConversation(zid, fields);

  // Generate short URL if needed
  if (options.generateShortUrl) {
    await urlService.generateAndReplaceZinvite(zid, options.generateShortUrl);
  }

  // Send created email if needed
  if (options.sendCreatedEmail) {
    try {
      await sendCreatedEmail(options.uid, zid);
    } catch (err) {
      logger.error('polis_err_sending_conversation_created_email', err);
    }
  }

  // Update modified time
  await db.updateConversationModifiedTime(zid);

  // Mark as moderator
  updatedConversation.is_mod = true;

  return updatedConversation;
}

/**
 * Send an email when a conversation is created
 * @param {number} uid - User ID
 * @param {number} zid - Conversation ID
 * @returns {Promise<void>}
 */
async function sendCreatedEmail(uid, zid) {
  try {
    // Get user info and conversation ID
    const [userInfo, zinvite] = await Promise.all([getUserInfoForUid2(uid), getZinvite(zid)]);

    // Send email if user has an email address
    if (userInfo?.email) {
      await sendCreatedLinkToEmail(userInfo.email, zinvite);
    }
  } catch (error) {
    logger.error('Error sending created email', error);
    throw error;
  }
}

/**
 * Get conversations based on various criteria
 * @param {Object} options - Query options
 * @param {Object} req - Express request object (for URL building)
 * @returns {Promise<Array>} - Array of conversations
 */
async function getConversations(options, req) {
  try {
    // Get conversations from repository
    logger.debug('Getting participant info', {
      uid: options.uid,
      includeAll: options.includeAllConversationsIAmIn,
      allOptions: options
    });

    const participantInfo = await db.getParticipantInfo(options.uid, options.includeAllConversationsIAmIn);

    logger.debug('Participant info result', participantInfo);

    const participantInOrSiteAdminOf = participantInfo.participantInOrSiteAdminOf;
    const isSiteAdmin = participantInfo.isSiteAdmin;

    // Build query options
    const queryOptions = {
      uid: options.uid,
      zid: options.zid,
      context: options.context,
      courseInvite: options.courseInvite,
      courseId: options.courseId,
      isActive: options.isActive,
      isDraft: options.isDraft,
      participantInOrSiteAdminOf,
      limit: options.limit || 999
    };

    logger.debug('Query options for getConversations', queryOptions);

    // Get conversations from repository
    const conversations = await db.getConversations(queryOptions);

    logger.debug('Raw conversations result', {
      count: conversations.length,
      conversations: conversations.map((c) => ({
        zid: c.zid,
        owner: c.owner,
        created: c.created
      }))
    });

    if (!conversations || conversations.length === 0) {
      logger.debug('No conversations found, returning empty array');
      return [];
    }

    // Process conversations
    const processedConversations = await processConversations(conversations, {
      uid: options.uid,
      xid: options.xid,
      wantModUrl: options.wantModUrl,
      wantUpvoted: options.wantUpvoted,
      wantInboxItemAdminUrl: options.wantInboxItemAdminUrl,
      wantInboxItemParticipantUrl: options.wantInboxItemParticipantUrl,
      wantInboxItemAdminHtml: options.wantInboxItemAdminHtml,
      wantInboxItemParticipantHtml: options.wantInboxItemParticipantHtml,
      isSiteAdmin,
      req
    });

    logger.debug('Final processed conversations', {
      count: processedConversations.length,
      sample: processedConversations[0]
    });

    return processedConversations;
  } catch (error) {
    logger.error('Error in getConversations service', error);
    throw error;
  }
}

/**
 * Process conversations to add additional data
 * @param {Array} conversations - Raw conversations from database
 * @param {Object} options - Processing options
 * @returns {Promise<Array>} - Processed conversations
 */
async function processConversations(conversations, options) {
  try {
    logger.debug('Processing conversations', {
      count: conversations.length,
      sampleZid: conversations[0]?.zid,
      options
    });

    // Add conversation IDs
    const conversationsWithIds = await urlService.addConversationIds(conversations);

    logger.debug('Added conversation IDs', {
      count: conversationsWithIds.length,
      sampleConversation: conversationsWithIds[0]
    });

    // Get single-use URLs if needed
    let suurlData = null;
    if (options.xid) {
      const suurls = await Promise.all(
        conversationsWithIds.map((conv) => urlService.createOneSuzinvite(options.xid, conv.zid, conv.owner))
      );
      suurlData = _.indexBy(suurls, 'zid');
    }

    // Get upvotes if needed
    let upvotes = null;
    if (options.uid && options.wantUpvoted) {
      const upvoteResults = await getUpvotesForUser(options.uid);
      upvotes = _.indexBy(upvoteResults, 'zid');
    }

    // Process each conversation
    const processedConversations = conversationsWithIds.map((conv) => {
      // Add owner flag
      conv.is_owner = conv.owner === options.uid;

      // Add URLs if needed
      if (options.wantModUrl) {
        conv.mod_url = urlService.createModerationUrl(conv.conversation_id);
      }

      if (options.wantInboxItemAdminUrl) {
        conv.inbox_item_admin_url = `${serverUrl}/iim/${conv.conversation_id}`;
      }

      if (options.wantInboxItemParticipantUrl) {
        conv.inbox_item_participant_url = `${serverUrl}/iip/${conv.conversation_id}`;
      }

      if (options.wantInboxItemAdminHtml) {
        conv.inbox_item_admin_html = `<a href='${serverUrl}/${conv.conversation_id}'>${conv.topic || conv.created}</a> <a href='${serverUrl}/m/${conv.conversation_id}'>moderate</a>`;
        conv.inbox_item_admin_html_escaped = conv.inbox_item_admin_html.replace(/'/g, "\\'");
      }

      if (options.wantInboxItemParticipantHtml) {
        conv.inbox_item_participant_html = `<a href='${serverUrl}/${conv.conversation_id}'>${conv.topic || conv.created}</a>`;
        conv.inbox_item_participant_html_escaped = conv.inbox_item_participant_html?.replace(/'/g, "\\'");
      }

      // Add URL
      if (suurlData) {
        conv.url = suurlData[conv.zid || '']?.suurl;
      } else {
        conv.url = urlService.buildConversationUrl(conv.conversation_id);
      }

      // Add upvoted flag
      if (upvotes?.[conv.zid || '']) {
        conv.upvoted = true;
      }

      // Format dates
      conv.created = Number(conv.created);
      conv.modified = Number(conv.modified);

      // Set default topic if needed
      if (_.isUndefined(conv.topic) || conv.topic === '') {
        conv.topic = new Date(conv.created).toUTCString();
      }

      // Add moderator flag
      conv.is_mod = conv.is_owner || options.isSiteAdmin[conv.zid || ''];

      // Remove unnecessary fields
      conv.zid = undefined;
      conv.is_anon = undefined;
      conv.is_draft = undefined;
      conv.is_public = undefined;

      if (conv.context === '') {
        conv.context = undefined;
      }

      return conv;
    });

    logger.debug('Processed conversations', {
      count: processedConversations.length,
      sampleProcessed: processedConversations[0]
    });

    return processedConversations;
  } catch (error) {
    logger.error('Error in processConversations', error);
    throw error;
  }
}

/**
 * Get conversations with recent activity based on a specific field
 * @param {number} uid - User ID
 * @param {number} sinceUnixTimestamp - Timestamp to filter conversations from
 * @param {string} field - Field to filter by ('created' or 'modified')
 * @returns {Promise<Array>} - Array of conversations
 */
async function getConversationsRecent(uid, sinceUnixTimestamp, field) {
  try {
    // Check if user is a developer (admin)
    const isAdmin = await db.isUserDeveloper(uid);
    if (!isAdmin) {
      throw new Error('polis_err_no_access_for_this_user');
    }

    // Calculate timestamp
    let time = sinceUnixTimestamp;
    if (_.isUndefined(time)) {
      time = Date.now() - 1000 * 60 * 60 * 24 * 7; // Default to 7 days ago
    } else {
      time *= 1000; // Convert to milliseconds
    }

    // Get conversations
    return await db.getConversationsWithFieldGreaterThan(field, time);
  } catch (error) {
    logger.error('Error getting recent conversations', error);
    throw error;
  }
}

/**
 * Get statistics for a conversation
 * @param {number} zid - Conversation ID
 * @param {number} until - Timestamp to filter until
 * @returns {Promise<Object>} - Conversation statistics
 */
async function getConversationStats(zid, until) {
  try {
    // Get comments and votes
    const [comments, votes] = await Promise.all([db.getCommentsForStats(zid, until), db.getVotesForStats(zid, until)]);

    // Cast timestamps to numbers
    const castTimestamp = (o) => {
      o.created = Number(o.created);
      return o;
    };

    const commentsWithTimestamps = comments.map(castTimestamp);
    const votesWithTimestamps = votes.map(castTimestamp);

    // Group votes by participant
    const votesGroupedByPid = _.groupBy(votesWithTimestamps, 'pid');

    // Create votes histogram
    const votesHistogramObj = {};
    _.each(votesGroupedByPid, (votesByParticipant) => {
      votesHistogramObj[votesByParticipant.length] = votesHistogramObj[votesByParticipant.length] + 1 || 1;
    });

    let votesHistogram = [];
    _.each(votesHistogramObj, (ptptCount, voteCount) => {
      votesHistogram.push({
        n_votes: voteCount,
        n_ptpts: ptptCount
      });
    });
    votesHistogram.sort((a, b) => a.n_ptpts - b.n_ptpts);

    // Calculate bursts
    const burstsForPid = {};
    const interBurstGap = 10 * 60 * 1000;

    _.each(votesGroupedByPid, (votesByParticipant, pid) => {
      burstsForPid[pid] = 1;
      let prevCreated = votesByParticipant.length ? votesByParticipant[0].created : 0;

      for (let v = 1; v < votesByParticipant.length; v++) {
        const vote = votesByParticipant[v];
        if (interBurstGap + prevCreated < vote.created) {
          burstsForPid[pid] += 1;
        }
        prevCreated = vote.created;
      }
    });

    // Create burst histogram
    const burstHistogramObj = {};
    _.each(burstsForPid, (bursts) => {
      burstHistogramObj[bursts] = burstHistogramObj[bursts] + 1 || 1;
    });

    const burstHistogram = [];
    _.each(burstHistogramObj, (ptptCount, burstCount) => {
      burstHistogram.push({
        n_ptpts: ptptCount,
        n_bursts: Number(burstCount)
      });
    });
    burstHistogram.sort((a, b) => a.n_bursts - b.n_bursts);

    // Get first vote and comment for each participant
    const getFirstForPid = (items) => {
      const o = {};
      const firstItems = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const pid = item.pid;

        if (!o[pid]) {
          o[pid] = 1;
          firstItems.push(item);
        }
      }

      return firstItems;
    };

    // Get participant and comment times
    let actualParticipants = getFirstForPid(votesWithTimestamps);
    actualParticipants = _.pluck(actualParticipants, 'created');

    let commenters = getFirstForPid(commentsWithTimestamps);
    commenters = _.pluck(commenters, 'created');

    const totalComments = _.pluck(commentsWithTimestamps, 'created');
    const totalVotes = _.pluck(votesWithTimestamps, 'created');

    // Format histogram values
    votesHistogram = _.map(votesHistogram, (x) => ({
      n_votes: Number(x.n_votes),
      n_ptpts: Number(x.n_ptpts)
    }));

    // Return stats
    return {
      voteTimes: totalVotes,
      firstVoteTimes: actualParticipants,
      commentTimes: totalComments,
      firstCommentTimes: commenters,
      votesHistogram: votesHistogram,
      burstHistogram: burstHistogram
    };
  } catch (error) {
    logger.error('Error getting conversation stats', error);
    throw error;
  }
}

/**
 * Set a conversation's active status
 * @param {number} zid - Conversation ID
 * @param {number} uid - User ID
 * @param {boolean} isActive - Whether the conversation should be active
 * @returns {Promise<void>}
 */
async function setConversationActive(zid, uid, isActive) {
  try {
    // Check if user is owner or admin
    const conversation = await db.getConversationForOwner(zid, uid);

    if (!conversation) {
      throw new Error('polis_err_closing_conversation_no_such_conversation');
    }

    // Update conversation
    await db.updateConversationActive(zid, isActive);

    return;
  } catch (error) {
    logger.error(`Error ${isActive ? 'opening' : 'closing'} conversation`, error);
    throw error;
  }
}

/**
 * Get conversation preload information
 * @param {string} conversationId - Conversation ID (zinvite)
 * @returns {Promise<Object>} - Conversation preload information
 */
async function getConversationPreloadInfo(conversationId) {
  try {
    // Get conversation ZID
    const zid = await getZidFromConversationId(conversationId);

    // Get conversation info
    const conv = await getConversationInfo(zid);

    // Set default values
    const DEFAULTS = {
      auth_opt_allow_3rdparty: true
    };

    // Format conversation info
    const formattedConv = {
      topic: conv.topic,
      description: conv.description,
      created: conv.created,
      link_url: conv.link_url,
      parent_url: conv.parent_url,
      vis_type: conv.vis_type,
      write_type: conv.write_type,
      importance_enabled: conv.importance_enabled,
      help_type: conv.help_type,
      socialbtn_type: conv.socialbtn_type,
      bgcolor: conv.bgcolor,
      help_color: conv.help_color,
      help_bgcolor: conv.help_bgcolor,
      style_btn: conv.style_btn,
      auth_needed_to_vote: false,
      auth_needed_to_write: false,
      auth_opt_allow_3rdparty: ifDefinedFirstElseSecond(conv.auth_opt_allow_3rdparty, DEFAULTS.auth_opt_allow_3rdparty),
      conversation_id: conversationId
    };

    return formattedConv;
  } catch (error) {
    logger.error('Error getting conversation preload info', error);
    throw error;
  }
}

/**
 * Create a new conversation
 * @param {Object} conversationData - Conversation data
 * @param {string} requestedConversationId - Requested conversation ID (optional)
 * @param {boolean} generateShortUrl - Whether to generate a short URL
 * @returns {Promise<Object>} - Created conversation info
 */
async function createConversation(conversationData, requestedConversationId, generateShortUrl) {
  try {
    // Create conversation in database
    const conversation = await db.createConversation(conversationData);
    const zid = conversation.zid;

    // Generate zinvite (conversation ID)
    let zinvite;
    if (requestedConversationId) {
      // Check if the requested conversation ID is available (zid = 0)
      const existingZid = await getZidFromConversationId(requestedConversationId);
      if (existingZid !== 0) {
        throw new Error('polis_err_conversation_id_already_in_use');
      }
      zinvite = requestedConversationId;
    } else {
      zinvite = await generateAndRegisterZinvite(zid, generateShortUrl);
    }

    // Build conversation URL
    const url = urlService.buildConversationUrl(zinvite);

    return {
      url,
      zid,
      zinvite
    };
  } catch (error) {
    logger.error('Error creating conversation', error);
    throw error;
  }
}

/**
 * Get page ID for a site and page
 * @param {string} site_id - Site ID
 * @param {string} page_id - Page ID
 * @returns {Promise<Object|null>} - Page ID info or null if not found
 */
async function getPageId(site_id, page_id) {
  try {
    return await db.getPageId(site_id, page_id);
  } catch (error) {
    logger.error('Error getting page ID', error);
    throw error;
  }
}

/**
 * Initialize an implicit conversation
 * @param {string} site_id - Site ID
 * @param {string} page_id - Page ID
 * @param {Object} options - Conversation options
 * @returns {Promise<Object>} - Created conversation info
 */
async function initializeImplicitConversation(site_id, page_id, options) {
  try {
    // Get site owner
    const siteOwner = await db.getSiteOwner(site_id);
    if (!siteOwner) {
      throw new Error('polis_err_bad_site_id');
    }

    const uid = siteOwner.uid;
    const generateShortUrl = false;

    // Prepare conversation data
    const conversationData = {
      ...options,
      owner: uid,
      org_id: uid,
      is_active: true,
      is_draft: false,
      is_public: true,
      is_anon: false,
      profanity_filter: true,
      spam_filter: true,
      strict_moderation: false,
      owner_sees_participation_stats: false
    };

    // Create conversation
    const conversation = await db.createConversation(conversationData);
    const zid = conversation.zid;

    // Register page ID
    await db.registerPageId(site_id, page_id, zid);

    // Generate zinvite
    const zinvite = await generateAndRegisterZinvite(zid, generateShortUrl);

    return {
      owner: uid,
      zid,
      zinvite
    };
  } catch (error) {
    logger.error('Error initializing implicit conversation', error);
    throw error;
  }
}

/**
 * Append parameters to an implicit conversation URL
 * @param {string} url - Base URL
 * @param {Object} params - Parameters to append
 * @returns {string} - URL with parameters
 */
function appendImplicitConversationParams(url, params) {
  let urlWithParams = `${url}?site_id=${params.site_id}&page_id=${params.page_id}`;

  // Add optional parameters if defined
  const optionalParams = [
    'ucv',
    'ucw',
    'ucst',
    'ucsd',
    'ucsv',
    'ucsf',
    'ui_lang',
    'ucsh',
    'subscribe_type',
    'xid',
    'dwok'
  ];

  for (const param of optionalParams) {
    if (params[param] !== undefined) {
      urlWithParams += `&${param}=${params[param]}`;
    }
  }

  // Add encoded parameters
  const encodedParams = ['x_name', 'x_profile_image_url', 'x_email', 'parent_url'];

  for (const param of encodedParams) {
    if (params[param] !== undefined) {
      urlWithParams += `&${param}=${encodeURIComponent(params[param])}`;
    }
  }

  return urlWithParams;
}

/**
 * Check if a conversation has metadata
 * @param {number} zid - Conversation ID
 * @returns {Promise<boolean>} - Whether the conversation has metadata
 */
async function getConversationHasMetadata(zid) {
  try {
    const rows = await db.getConversationMetadataQuestions(zid);
    return rows && rows.length > 0;
  } catch (err) {
    logger.error('Error checking if conversation has metadata', { error: err, zid });
    return false;
  }
}

/**
 * Get translations for a conversation
 * @param {number} zid - Conversation ID
 * @param {string} lang - Language code
 * @returns {Promise<Object[]>} - Array of translations
 */
async function getConversationTranslations(zid, lang) {
  try {
    const rows = await db.getConversationTranslationsByLang(zid, lang);
    return rows || [];
  } catch (err) {
    logger.error('Error getting conversation translations', { error: err, zid, lang });
    return [];
  }
}

/**
 * Get minimal translations for a conversation
 * @param {number} zid - Conversation ID
 * @param {string} lang - Language code
 * @returns {Promise<Object[]>} - Minimal translations
 */
async function getConversationTranslationsMinimal(zid, lang) {
  if (!lang) {
    return [];
  }
  try {
    const rows = await getConversationTranslations(zid, lang);
    for (let i = 0; i < rows.length; i++) {
      rows[i].zid = undefined;
      rows[i].created = undefined;
      rows[i].modified = undefined;
      rows[i].src = undefined;
    }
    return rows;
  } catch (err) {
    logger.error('Error getting minimal conversation translations', { error: err, zid, lang });
    return [];
  }
}

/**
 * Get detailed information for a single conversation
 * @param {number} zid - Conversation ID
 * @param {number} uid - User ID
 * @param {string} [lang] - Language code
 * @returns {Promise<Object>} - Conversation information
 */
async function getOneConversation(zid, uid, lang) {
  try {
    // Get all necessary data in parallel
    const [conversationRows, convHasMetadata, requestingUserInfo, translations] = await Promise.all([
      db.getConversationWithOwner(zid),
      db.getConversationHasMetadata(zid),
      uid ? db.getUserInfoForUid2(uid) : Promise.resolve({}),
      lang ? db.getConversationTranslationsMinimal(zid, lang) : Promise.resolve(null)
    ]);

    // Check if conversation exists
    const conv = conversationRows?.[0];
    if (!conv) {
      throw new Error('polis_err_conversation_not_found');
    }

    // Set default auth options
    conv.auth_opt_allow_3rdparty = ifDefinedFirstElseSecond(
      conv.auth_opt_allow_3rdparty,
      DEFAULTS.auth_opt_allow_3rdparty
    );

    // Add translations
    conv.translations = translations;

    // Get owner info
    const ownerInfo = await getUserInfoForUid2(conv.owner);
    const ownername = ownerInfo.hname;

    // Add metadata flag
    if (convHasMetadata) {
      conv.hasMetadata = true;
    }

    // Add owner name if available and not in specific context
    if (!_.isUndefined(ownername) && conv.context !== 'hongkong2014') {
      conv.ownername = ownername;
    }

    // Set moderation and ownership flags
    conv.is_mod = conv.site_id === requestingUserInfo.site_id;
    conv.is_owner = conv.owner === uid;

    // Remove sensitive data
    conv.uid = undefined;

    return conv;
  } catch (err) {
    logger.error('Error getting conversation', { error: err, zid, uid });
    throw err;
  }
}

/**
 * Get course ID from a course invite code
 * @param {string} courseInvite - The course invite code
 * @returns {Promise<Object>} - Object containing the course_id
 */
async function getCourseIdFromInvite(courseInvite) {
  try {
    const result = await db.getCourseByInvite(courseInvite);

    if (!result || !result.length) {
      throw new Error('polis_err_course_not_found');
    }

    return result[0];
  } catch (err) {
    logger.error('Error getting course ID from invite', { error: err, courseInvite });
    throw err;
  }
}

export {
  appendImplicitConversationParams,
  createConversation,
  generateAndRegisterZinvite,
  getConversationHasMetadata,
  getCourseIdFromInvite,
  getConversationInfo,
  getConversationInfoByConversationId,
  getConversationPreloadInfo,
  getConversations,
  getConversationsRecent,
  getConversationStats,
  getConversationTranslations,
  getConversationTranslationsMinimal,
  getOneConversation,
  getPageId,
  getZidFromConversationId,
  initializeImplicitConversation,
  processConversations,
  sendCreatedEmail,
  setConversationActive,
  updateConversation,
  verifyMetadataAnswersExistForEachQuestion
};
