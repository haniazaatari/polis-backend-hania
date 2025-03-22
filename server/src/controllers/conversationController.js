import { isModerator } from '../db/authorization.js';
import { sendImplicitConversationCreatedEmails } from '../email/specialized.js';
import * as cookieService from '../services/auth/cookieService.js';
import * as conversationService from '../services/conversation/conversationService.js';
import * as urlService from '../services/url/urlService.js';
import { generateAndRegisterZinvite, getZinvite } from '../services/zinvite/zinviteService.js';
import { DEFAULTS } from '../utils/constants.js';
import logger from '../utils/logger.js';
import { fail } from '../utils/responseHandlers.js';

/**
 * Extract conversation fields from request parameters
 * @param {Object} params - Request parameters
 * @returns {Object} - Conversation fields to update
 */
function extractConversationFields(params) {
  const fields = {};

  // Define fields to extract
  const fieldMappings = [
    'is_active',
    'is_anon',
    'is_draft',
    'is_data_open',
    'profanity_filter',
    'spam_filter',
    'strict_moderation',
    'topic',
    'description',
    'vis_type',
    'help_type',
    'socialbtn_type',
    'write_type',
    'importance_enabled',
    'auth_opt_allow_3rdparty',
    'owner_sees_participation_stats',
    'link_url',
    'subscribe_type'
  ];

  // Copy defined fields
  for (const field of fieldMappings) {
    if (params[field] !== undefined) {
      fields[field] = params[field];
    }
  }

  // Handle special cases
  for (const field of ['bgcolor', 'help_color', 'help_bgcolor']) {
    if (params[field] !== undefined) {
      fields[field] = params[field] === 'default' ? null : params[field];
    }
  }

  if (params.style_btn !== undefined) {
    fields.style_btn = params.style_btn;
  }

  return fields;
}

/**
 * Handle PUT request to update a conversation
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleUpdateConversation(req, res) {
  try {
    // Check if user is moderator
    const isMod = await isModerator(req.p.zid, req.p.uid);
    if (!isMod) {
      return fail(res, 403, 'polis_err_update_conversation_permission');
    }

    // Extract fields from request
    const updateFields = extractConversationFields(req.p);

    // Update conversation
    const updatedConversation = await conversationService.updateConversation(req.p.zid, updateFields, {
      verifyMeta: req.p.verifyMeta,
      generateShortUrl: req.p.short_url,
      sendCreatedEmail: req.p.send_created_email,
      uid: req.p.uid
    });

    // Return success
    const successCode = req.p.short_url ? 201 : 200;
    res.status(successCode).json(updatedConversation);
  } catch (err) {
    fail(res, 500, 'polis_err_update_conversation', err);
  }
}

/**
 * Handle GET request to retrieve conversations
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleGetConversations(req, res) {
  try {
    // If course_invite is provided, get the course_id
    if (req.p.course_invite) {
      try {
        const courseResult = await conversationService.getCourseIdFromInvite(req.p.course_invite);
        req.p.course_id = courseResult.course_id;
      } catch (err) {
        logger.error('Error getting course id from invite', err);
        // Continue without course_id if lookup fails
      }
    }

    // Check authentication
    if (!req.p.uid && !req.p.context) {
      return fail(res, 403, 'polis_err_need_auth');
    }

    // If zid is provided, get a single conversation
    if (req.p.zid) {
      try {
        // Get language from cookies if available
        const lang = cookieService.getLanguage(req.cookies, req.headers);
        const conversation = await conversationService.getOneConversation(req.p.zid, req.p.uid, lang);

        // Return the single conversation response
        return res.status(200).json(conversation);
      } catch (err) {
        logger.error('Error getting single conversation', err);
        return fail(res, 500, 'polis_err_get_conversations_2', err);
      }
    }

    // Otherwise, get multiple conversations
    const options = {
      uid: req.p.uid,
      zid: req.p.zid,
      xid: req.p.xid,
      includeAllConversationsIAmIn: req.p.include_all_conversations_i_am_in,
      wantModUrl: req.p.want_mod_url,
      wantUpvoted: req.p.want_upvoted,
      wantInboxItemAdminUrl: req.p.want_inbox_item_admin_url,
      wantInboxItemParticipantUrl: req.p.want_inbox_item_participant_url,
      wantInboxItemAdminHtml: req.p.want_inbox_item_admin_html,
      wantInboxItemParticipantHtml: req.p.want_inbox_item_participant_html,
      context: req.p.context,
      courseInvite: req.p.course_invite,
      courseId: req.p.course_id,
      isActive: req.p.is_active,
      isDraft: req.p.is_draft,
      limit: req.p.limit
    };

    // Log the options to help debug
    logger.debug('Conversation options:', {
      uid: options.uid,
      zid: options.zid,
      cookies: req.cookies,
      headers: req.headers,
      p: req.p
    });

    const conversations = await conversationService.getConversations(options, req);
    res.status(200).json(conversations);
  } catch (err) {
    logger.error('Error getting conversations', err);
    fail(res, 500, 'polis_err_get_conversations', err);
  }
}

/**
 * Handle GET request to retrieve conversations with recent activity
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleGetConversationsRecentActivity(req, res) {
  try {
    const conversations = await conversationService.getConversationsRecent(
      req.p.uid,
      req.p.sinceUnixTimestamp,
      'modified'
    );
    res.status(200).json(conversations);
  } catch (err) {
    fail(res, 403, 'polis_err_conversationsRecent', err);
  }
}

/**
 * Handle GET request to retrieve recently started conversations
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleGetConversationsRecentlyStarted(req, res) {
  try {
    const conversations = await conversationService.getConversationsRecent(
      req.p.uid,
      req.p.sinceUnixTimestamp,
      'created'
    );
    res.status(200).json(conversations);
  } catch (err) {
    fail(res, 403, 'polis_err_conversationsRecent', err);
  }
}

/**
 * Handle GET request to retrieve conversation statistics
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleGetConversationStats(req, res) {
  try {
    const zid = req.p.zid;
    const uid = req.p.uid;
    const until = req.p.until;
    const rid = req.p.rid;

    // Check if user has permission to view stats
    const hasPermission = rid ? true : await isModerator(zid, uid);

    if (!hasPermission) {
      return fail(res, 403, 'polis_err_conversationStats_need_report_id_or_moderation_permission');
    }

    const stats = await conversationService.getConversationStats(zid, until);
    res.status(200).json(stats);
  } catch (err) {
    fail(res, 500, 'polis_err_conversationStats_misc', err);
  }
}

/**
 * Handle POST request to close a conversation
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleCloseConversation(req, res) {
  try {
    await conversationService.setConversationActive(req.p.zid, req.p.uid, false);
    res.status(200).json({});
  } catch (err) {
    fail(res, 500, 'polis_err_closing_conversation', err);
  }
}

/**
 * Handle POST request to reopen a conversation
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleReopenConversation(req, res) {
  try {
    await conversationService.setConversationActive(req.p.zid, req.p.uid, true);
    res.status(200).json({});
  } catch (err) {
    fail(res, 500, 'polis_err_reopening_conversation', err);
  }
}

/**
 * Handle POST request to reserve a conversation ID
 * @param {Object} _req - Express request object
 * @param {Object} res - Express response object
 */
async function handleReserveConversationId(_req, res) {
  try {
    const zid = 0; // Special value for reserving a conversation ID
    const shortUrl = false;
    const conversationId = await generateAndRegisterZinvite(zid, shortUrl);

    res.status(200).json({
      conversation_id: conversationId
    });
  } catch (err) {
    fail(res, 500, 'polis_err_reserve_conversation_id', err);
  }
}

/**
 * Handle GET request to retrieve conversation preload info
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleGetConversationPreloadInfo(req, res) {
  try {
    const conversationInfo = await conversationService.getConversationPreloadInfo(req.p.conversation_id);
    res.status(200).json(conversationInfo);
  } catch (err) {
    fail(res, 500, 'polis_err_get_conversation_preload_info', err);
  }
}

/**
 * Handle GET request for IIP conversation
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleGetIipConversation(req, res) {
  try {
    const conversationId = req.params.conversation_id;

    res.set({
      'Content-Type': 'text/html'
    });

    res.send(`<a href='https://pol.is/${conversationId}' target='_blank'>${conversationId}</a>`);
  } catch (err) {
    fail(res, 500, 'polis_err_fetching_conversation_info', err);
  }
}

/**
 * Handle GET request for IIM conversation
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleGetIimConversation(req, res) {
  try {
    const zid = req.p.zid;
    const conversationId = req.params.conversation_id;

    const info = await conversationService.getConversationInfo(zid);

    res.set({
      'Content-Type': 'text/html'
    });

    const title = info.topic || info.created;
    res.send(
      `<a href='https://pol.is/${conversationId}' target='_blank'>${title}</a><p><a href='https://pol.is/m${conversationId}' target='_blank'>moderate</a></p>${info.description ? `<p>${info.description}</p>` : ''}`
    );
  } catch (err) {
    fail(res, 500, 'polis_err_fetching_conversation_info', err);
  }
}

/**
 * Handle POST request to create a new conversation
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleCreateConversation(req, res) {
  try {
    // Prepare conversation data
    const conversationData = {
      owner: req.p.uid,
      org_id: req.p.org_id || req.p.uid,
      topic: req.p.topic,
      description: req.p.description,
      is_active: req.p.is_active,
      is_data_open: req.p.is_data_open,
      is_draft: req.p.is_draft,
      is_public: true,
      is_anon: req.p.is_anon,
      profanity_filter: req.p.profanity_filter,
      spam_filter: req.p.spam_filter,
      strict_moderation: req.p.strict_moderation,
      context: req.p.context || null,
      owner_sees_participation_stats: !!req.p.owner_sees_participation_stats,
      // Add auth fields with defaults
      auth_needed_to_vote:
        req.p.auth_needed_to_vote !== undefined ? req.p.auth_needed_to_vote : DEFAULTS.auth_needed_to_vote,
      auth_needed_to_write:
        req.p.auth_needed_to_write !== undefined ? req.p.auth_needed_to_write : DEFAULTS.auth_needed_to_write,
      auth_opt_allow_3rdparty:
        req.p.auth_opt_allow_3rdparty !== undefined ? req.p.auth_opt_allow_3rdparty : DEFAULTS.auth_opt_allow_3rdparty
    };

    // Create conversation
    const result = await conversationService.createConversation(
      conversationData,
      req.p.conversation_id,
      req.p.short_url
    );

    // Return success with both url and conversation_id to satisfy both test helper and test
    res.status(200).json({
      url: result.url,
      conversation_id: result.zinvite
    });
  } catch (err) {
    if (err.message === 'polis_err_conversation_id_already_in_use') {
      fail(res, 400, 'polis_err_conversation_id_already_in_use', err);
    } else if (err.code === '23505') {
      // Duplicate key error
      logger.error('polis_err_add_conversation', err);
      fail(res, 409, 'polis_err_add_conversation_duplicate', err);
    } else {
      fail(res, 500, 'polis_err_add_conversation', err);
    }
  }
}

/**
 * Handle GET request for implicit conversation generation
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleImplicitConversationGeneration(req, res) {
  try {
    // Extract site_id and page_id from path
    let site_id = /polis_site_id[^\/]*/.exec(req.path) || null;
    let page_id = /\S\/([^\/]*)/.exec(req.path) || null;

    if (!site_id?.length || (page_id && page_id?.length < 2)) {
      return fail(res, 404, 'polis_err_parsing_site_id_or_page_id');
    }

    site_id = site_id[0];
    page_id = page_id[1];

    // Prepare conversation options
    const conversationOptions = {};

    // Copy parameters from request if defined
    if (req.p.parent_url) {
      conversationOptions.parent_url = req.p.parent_url;
    }
    if (req.p.auth_opt_allow_3rdparty !== undefined) {
      conversationOptions.auth_opt_allow_3rdparty = req.p.auth_opt_allow_3rdparty;
    }
    if (req.p.topic) {
      conversationOptions.topic = req.p.topic;
    }

    // Set visualization type based on show_vis parameter
    if (req.p.show_vis !== undefined) {
      conversationOptions.vis_type = req.p.show_vis ? 1 : 0;
    }

    // Set background color based on bg_white parameter
    if (req.p.bg_white !== undefined) {
      conversationOptions.bgcolor = req.p.bg_white ? '#fff' : null;
    }

    // Set social button type based on show_share parameter
    conversationOptions.socialbtn_type = req.p.show_share ? 1 : 0;

    // Set cookies if needed
    if (req.p.referrer) {
      cookieService.setParentReferrerCookie(req, res, req.p.referrer);
    }
    if (req.p.parent_url) {
      cookieService.setParentUrlCookie(req, res, req.p.parent_url);
    }

    // Check if page_id already exists
    const existingPageId = await conversationService.getPageId(site_id, page_id);

    let url;
    if (!existingPageId) {
      // Initialize new implicit conversation
      const conv = await conversationService.initializeImplicitConversation(site_id, page_id, conversationOptions);

      // Build URL based on demo parameter
      url =
        req.p.demo === undefined
          ? urlService.buildConversationUrl(conv.zinvite)
          : urlService.buildConversationDemoUrl(conv.zinvite);

      // Build moderation and seed URLs
      const modUrl = urlService.buildModerationUrl(conv.zinvite);
      const seedUrl = urlService.buildSeedUrl(conv.zinvite);

      // Send notification emails
      try {
        await sendImplicitConversationCreatedEmails(site_id, page_id, url, modUrl, seedUrl);
        logger.info('Implicit conversation creation email sent');
      } catch (emailErr) {
        logger.error('Error sending implicit conversation creation email', emailErr);
      }
    } else {
      // Get zinvite for existing conversation
      const conversation_id = await getZinvite(existingPageId.zid);
      url = urlService.buildConversationUrl(conversation_id);
    }

    // Append URL parameters
    url = conversationService.appendImplicitConversationParams(url, {
      site_id,
      page_id,
      ucv: req.p.ucv,
      ucw: req.p.ucw,
      ucsh: req.p.ucsh,
      ucst: req.p.ucst,
      ucsd: req.p.ucsd,
      ucsv: req.p.ucsv,
      ucsf: req.p.ucsf,
      ui_lang: req.p.ui_lang,
      subscribe_type: req.p.subscribe_type,
      xid: req.p.xid,
      x_name: req.p.x_name,
      x_profile_image_url: req.p.x_profile_image_url,
      x_email: req.p.x_email,
      parent_url: req.p.parent_url,
      dwok: req.p.dwok
    });

    // Redirect to conversation
    res.redirect(url);
  } catch (err) {
    if (err.message === 'polis_err_bad_site_id') {
      fail(res, 404, 'polis_err_bad_site_id', err);
    } else {
      fail(res, 500, 'polis_err_implicit_conversation_generation', err);
    }
  }
}

export {
  handleUpdateConversation,
  handleGetConversations,
  handleGetConversationsRecentActivity,
  handleGetConversationsRecentlyStarted,
  handleGetConversationStats,
  handleCloseConversation,
  handleReopenConversation,
  handleReserveConversationId,
  handleGetConversationPreloadInfo,
  handleGetIipConversation,
  handleGetIimConversation,
  handleCreateConversation,
  handleImplicitConversationGeneration
};
