import _ from "underscore";
import { ConversationType } from "../d";
import { isModerator } from "../utils/common";
import { isValidColor } from "../utils/colors";
import { isValidFont } from "../utils/fonts";
import { queryP } from "../db/pg-query";
import { sql_conversations } from "../db/sql";
import fail from "../utils/fail";
import logger from "../utils/logger";
import { getUserInfoForUid2 } from "../user";
import {
  finishOne,
  generateAndReplaceZinvite,
  getConversationUrl,
  ifDefinedSet,
  sendEmailByUid,
  updateConversationModifiedTime,
  verifyMetadataAnswersExistForEachQuestion,
} from "../serverHelpers";

export default async function handle_PUT_conversations(
  req: {
    p: {
      short_url: any;
      zid: any;
      uid?: any;
      verifyMeta: any;
      is_active: any;
      is_anon: any;
      is_draft: any;
      is_data_open: any;
      profanity_filter: any;
      spam_filter: any;
      strict_moderation: any;
      topic: string;
      description: string;
      vis_type: any;
      help_type: any;
      bgcolor: string;
      style_btn: any;
      write_type: any;
      importance_enabled: any;
      owner_sees_participation_stats: any;
      launch_presentation_return_url_hex: any;
      link_url: any;
      send_created_email: any;
      conversation_id: string;
      context: any;
      font_color: any;
      font_title: any;
      font_serif: any;
      font_sans: any;
    };
  },
  res: any
) {
  const generateShortUrl = req.p.short_url;

  try {
    const ok = await isModerator(req.p.zid, req.p.uid);
    if (!ok) {
      return fail(res, 403, "polis_err_update_conversation_permission");
    }

    if (req.p.verifyMeta) {
      await verifyMetadataAnswersExistForEachQuestion(req.p.zid);
    }

    const fields: ConversationType = {};
    if (!_.isUndefined(req.p.is_active)) {
      fields.is_active = req.p.is_active;
    }
    if (!_.isUndefined(req.p.is_anon)) {
      fields.is_anon = req.p.is_anon;
    }
    if (!_.isUndefined(req.p.is_draft)) {
      fields.is_draft = req.p.is_draft;
    }
    if (!_.isUndefined(req.p.is_data_open)) {
      fields.is_data_open = req.p.is_data_open;
    }
    if (!_.isUndefined(req.p.profanity_filter)) {
      fields.profanity_filter = req.p.profanity_filter;
    }
    if (!_.isUndefined(req.p.spam_filter)) {
      fields.spam_filter = req.p.spam_filter;
    }
    if (!_.isUndefined(req.p.strict_moderation)) {
      fields.strict_moderation = req.p.strict_moderation;
    }
    if (!_.isUndefined(req.p.topic)) {
      fields.topic = req.p.topic;
    }
    if (!_.isUndefined(req.p.description)) {
      fields.description = req.p.description;
    }
    if (!_.isUndefined(req.p.vis_type)) {
      fields.vis_type = req.p.vis_type;
    }
    if (!_.isUndefined(req.p.help_type)) {
      fields.help_type = req.p.help_type;
    }
    if (!_.isUndefined(req.p.bgcolor)) {
      if (req.p.bgcolor === "default") {
        fields.bgcolor = null;
      } else if (isValidColor(req.p.bgcolor)) {
        fields.bgcolor = req.p.bgcolor;
      } else {
        return fail(res, 422, "polis_err_invalid_color_bgcolor");
      }
    }
    if (!_.isUndefined(req.p.style_btn)) {
      if (isValidColor(req.p.style_btn)) {
        fields.style_btn = req.p.style_btn;
      } else {
        return fail(res, 422, "polis_err_invalid_color_style_btn");
      }
    }
    if (!_.isUndefined(req.p.font_color)) {
      if (isValidColor(req.p.font_color)) {
        fields.font_color = req.p.font_color;
      } else {
        return fail(res, 422, "polis_err_invalid_color_font_color");
      }
    }
    if (!_.isUndefined(req.p.write_type)) {
      fields.write_type = req.p.write_type;
    }
    if (!_.isUndefined(req.p.importance_enabled)) {
      fields.importance_enabled = req.p.importance_enabled;
    }
    ifDefinedSet("auth_opt_allow_3rdparty", req.p, fields);

    if (!_.isUndefined(req.p.owner_sees_participation_stats)) {
      fields.owner_sees_participation_stats = !!req.p
        .owner_sees_participation_stats;
    }
    if (!_.isUndefined(req.p.link_url)) {
      fields.link_url = req.p.link_url;
    }

    if (!_.isUndefined(req.p.font_title)) {
      const isValid = await isValidFont(req.p.font_title);
      if (!isValid) {
        return fail(res, 422, "polis_err_invalid_font_font_title");
      }
      fields.font_title = req.p.font_title;
    }

    if (!_.isUndefined(req.p.font_serif)) {
      const isValid = await isValidFont(req.p.font_serif);
      if (!isValid) {
        return fail(res, 422, "polis_err_invalid_font_font_serif");
      }
      fields.font_serif = req.p.font_serif;
    }

    if (!_.isUndefined(req.p.font_sans)) {
      const isValid = await isValidFont(req.p.font_sans);
      if (!isValid) {
        return fail(res, 422, "polis_err_invalid_font_font_sans");
      }
      fields.font_sans = req.p.font_sans;
    }

    ifDefinedSet("subscribe_type", req.p, fields);

    const q = sql_conversations
      .update(fields)
      .where(sql_conversations.zid.equals(req.p.zid))
      .returning("*");

    const rows = await queryP(q.toString());

    const conv = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    if (!conv) {
      return fail(res, 404, "polis_err_conversation_not_found_after_update");
    }
    conv.is_mod = true;

    if (generateShortUrl) {
      await generateAndReplaceZinvite(req.p.zid, generateShortUrl);
    }
    const successCode = generateShortUrl ? 201 : 200;

    if (req.p.send_created_email) {
      (async () => {
        try {
          const [userInfo, url] = await Promise.all([
            getUserInfoForUid2(req.p.uid),
            getConversationUrl(req, req.p.zid, true),
          ]);
          const hname = userInfo.hname;
          const emailBody = `Hi ${hname},\n\nHere's a link to the conversation you just created. Use it to invite participants to the conversation. Share it by whatever network you prefer - Gmail, Facebook, Twitter, etc., or just post it to your website or blog. Try it now! Click this link to go to your conversation:\n${url}\n\nWith gratitude,\n\nThe Polis Team`;
          await sendEmailByUid(
            req.p.uid,
            "Conversation created",
            emailBody
          );
          logger.debug(`Sent conversation created email to UID ${req.p.uid}`);
        } catch (emailErr) {
          logger.error("polis_err_sending_conversation_created_email", emailErr);
        }
      })();
    }

    await finishOne(res, conv, true, successCode);

    updateConversationModifiedTime(req.p.zid).catch(err => {
      logger.error(`Failed to update modified time for zid ${req.p.zid}`, err);
    });

  } catch (err: any) {
    logger.error("Error in handle_PUT_conversations:", err);
    if (err?.message === "polis_err_missing_metadata_answers") {
      return fail(res, 500, err.message, err);
    }
    return fail(res, 500, "polis_err_update_conversation_failed", err);
  }
}
