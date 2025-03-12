import express from 'express';
import {
  handleCloseConversation,
  handleCreateConversation,
  handleGetConversationPreloadInfo,
  handleGetConversationStats,
  handleGetConversations,
  handleGetConversationsRecentActivity,
  handleGetConversationsRecentlyStarted,
  handleReopenConversation,
  handleReserveConversationId,
  handleUpdateConversation
} from '../controllers/conversationController.js';
import { auth, authOptional, moveToBody } from '../middlewares/index.js';
import {
  assignToP,
  assignToPCustom,
  getBool,
  getConversationIdFetchZid,
  getInt,
  getOptionalStringLimitLength,
  getReportIdFetchRid,
  getStringLimitLength,
  need,
  want
} from '../utils/parameter.js';

const router = express();

// GET conversations
router.get(
  '/conversations',
  moveToBody,
  authOptional(assignToP),
  want('zid', getConversationIdFetchZid, assignToPCustom('zid')),
  want('uid', getInt, assignToP),
  want('course_invite', getBool, assignToP),
  want('course_id', getInt, assignToP),
  want('include_all_conversations_i_am_in', getBool, assignToP),
  want('is_active', getBool, assignToP),
  want('is_draft', getBool, assignToP),
  want('context', getStringLimitLength(999), assignToP),
  want('want_mod_url', getBool, assignToP),
  want('want_upvoted', getBool, assignToP),
  want('want_inbox_item_admin_url', getBool, assignToP),
  want('want_inbox_item_participant_url', getBool, assignToP),
  want('want_inbox_item_admin_html', getBool, assignToP),
  want('want_inbox_item_participant_html', getBool, assignToP),
  want('limit', getInt, assignToP),
  handleGetConversations
);

// GET conversations recently started
router.get(
  '/conversations/recently_started',
  moveToBody,
  auth(assignToP),
  want('sinceUnixTimestamp', getInt, assignToP),
  handleGetConversationsRecentlyStarted
);

// GET conversations with recent activity
router.get(
  '/conversations/recent_activity',
  moveToBody,
  auth(assignToP),
  want('sinceUnixTimestamp', getInt, assignToP),
  handleGetConversationsRecentActivity
);

// GET conversation stats
router.get(
  '/conversationStats',
  moveToBody,
  authOptional(assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  want('report_id', getReportIdFetchRid, assignToPCustom('rid')),
  want('until', getInt, assignToP),
  handleGetConversationStats
);

// GET conversation preload info
router.get(
  '/conversation/preload',
  moveToBody,
  need('conversation_id', getStringLimitLength(1, 1000), assignToP),
  handleGetConversationPreloadInfo
);

// POST reserve conversation ID
router.post('/reserve_conversation_id', auth(assignToP), handleReserveConversationId);

// POST close conversation
router.post(
  '/conversation/close',
  moveToBody,
  auth(assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  handleCloseConversation
);

// POST reopen conversation
router.post(
  '/conversation/reopen',
  moveToBody,
  auth(assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  handleReopenConversation
);

// PUT conversations
router.put(
  '/conversations',
  moveToBody,
  auth(assignToP),
  need('conversation_id', getConversationIdFetchZid, assignToPCustom('zid')),
  need('conversation_id', getStringLimitLength(1, 1000), assignToP),
  want('is_active', getBool, assignToP),
  want('is_anon', getBool, assignToP),
  want('is_draft', getBool, assignToP, false),
  want('is_data_open', getBool, assignToP, false),
  want('owner_sees_participation_stats', getBool, assignToP, false),
  want('profanity_filter', getBool, assignToP),
  want('short_url', getBool, assignToP, false),
  want('spam_filter', getBool, assignToP),
  want('strict_moderation', getBool, assignToP),
  want('topic', getOptionalStringLimitLength(1000), assignToP),
  want('description', getOptionalStringLimitLength(50000), assignToP),
  want('importance_enabled', getBool, assignToP),
  want('vis_type', getInt, assignToP),
  want('help_type', getInt, assignToP),
  want('write_type', getInt, assignToP),
  want('socialbtn_type', getInt, assignToP),
  want('bgcolor', getOptionalStringLimitLength(20), assignToP),
  want('help_color', getOptionalStringLimitLength(20), assignToP),
  want('help_bgcolor', getOptionalStringLimitLength(20), assignToP),
  want('style_btn', getOptionalStringLimitLength(500), assignToP),
  want('auth_needed_to_vote', getBool, assignToP),
  want('auth_needed_to_write', getBool, assignToP),
  want('auth_opt_allow_3rdparty', getBool, assignToP),
  want('verifyMeta', getBool, assignToP),
  want('send_created_email', getBool, assignToP),
  want('context', getOptionalStringLimitLength(999), assignToP),
  want('link_url', getStringLimitLength(1, 9999), assignToP),
  want('subscribe_type', getInt, assignToP),
  handleUpdateConversation
);

// POST create conversation
router.post(
  '/conversations',
  auth(assignToP),
  want('is_active', getBool, assignToP, true),
  want('is_draft', getBool, assignToP, false),
  want('is_anon', getBool, assignToP, false),
  want('owner_sees_participation_stats', getBool, assignToP, false),
  want('profanity_filter', getBool, assignToP, true),
  want('short_url', getBool, assignToP, false),
  want('spam_filter', getBool, assignToP, true),
  want('strict_moderation', getBool, assignToP, false),
  want('context', getOptionalStringLimitLength(999), assignToP, ''),
  want('topic', getOptionalStringLimitLength(1000), assignToP, ''),
  want('description', getOptionalStringLimitLength(50000), assignToP, ''),
  want('conversation_id', getStringLimitLength(6, 300), assignToP, ''),
  want('is_data_open', getBool, assignToP, false),
  want('ownerXid', getStringLimitLength(1, 999), assignToP),
  want('auth_needed_to_vote', getBool, assignToP),
  want('auth_needed_to_write', getBool, assignToP),
  want('auth_opt_allow_3rdparty', getBool, assignToP),
  want('send_created_email', getBool, assignToP, false),
  handleCreateConversation
);

export default router;
