import {
  createInviteCode,
  redeemInviteCode,
  generateChildCodes,
  getConversationInviteTree,
  getUserInviteCodes,
  createInviteCodesTable,
} from "../utils/invite-codes";
import logger from "../utils/logger";
import { queryP as pgQuery } from "../db/pg-query";

// Table creation is handled by delphi/create_dynamodb_tables.py
// createInviteCodesTable().catch(err => 
//   logger.error("Failed to create invite codes table:", err)
// );

// Simple ownership check
async function checkIsOwner(zid: number, uid: number): Promise<boolean> {
  try {
    const result: any = await pgQuery(
      "SELECT owner FROM conversations WHERE zid = $1",
      [zid]
    );
    // queryP returns array directly, not {rows: [...]}
    return result && result.length > 0 && result[0].owner === uid;
  } catch (err) {
    logger.error("Error checking ownership:", err);
    return false;
  }
}

// Create root invite code (admin only)
export async function handle_POST_invite_codes_create(
  req: any,
  res: any
): Promise<void> {
  try {
    const zid = parseInt(req.p.zid);
    const uid = req.p.uid;
    
    // Check permissions
    if (!await checkIsOwner(zid, uid)) {
      res.status(403).json({ error: "Not authorized" });
      return;
    }
    
    const code = await createInviteCode(zid, undefined, uid);
    
    res.json({ 
      code,
      invite_url: `/invite/${code}`,
    });
  } catch (error: any) {
    logger.error("Error creating invite code:", error);
    res.status(500).json({ error: error.message });
  }
}

// Redeem invite code
export async function handle_POST_invite_redeem(
  req: any,
  res: any
): Promise<void> {
  try {
    const { code, conversation_id } = req.p;
    let uid = req.p.uid;
    
    // Create dummy user if not logged in
    if (!uid) {
      // TODO: Create dummy user logic
      // uid = await createDummyUser();
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    
    const inviteCode = await redeemInviteCode(conversation_id, code, uid);
    
    // TODO: Create XID record for tracking
    // const xid = `invite-${code}-${uid}`;
    // await createXidRecord(conversationOwner, uid, xid);
    
    res.json({ 
      success: true,
      conversation_id,
      wave_number: inviteCode.wave_number,
      redirect_url: `/c/${conversation_id}`,
    });
  } catch (error: any) {
    logger.error("Error redeeming invite code:", error);
    res.status(400).json({ error: error.message });
  }
}

// Generate child codes (admin)
export async function handle_POST_invite_codes_generate_children(
  req: any,
  res: any
): Promise<void> {
  try {
    const { zid, parent_code, count = 5 } = req.p;
    const uid = req.p.uid;
    
    if (!await checkIsOwner(zid, uid)) {
      res.status(403).json({ error: "Not authorized" });
      return;
    }
    
    const codes = await generateChildCodes(zid, parent_code, count, uid);
    
    res.json({ 
      generated_codes: codes,
      invite_urls: codes.map(code => 
        `/invite/${code}`
      ),
    });
  } catch (error: any) {
    logger.error("Error generating child codes:", error);
    res.status(500).json({ error: error.message });
  }
}

// Get invite tree (admin view)
export async function handle_GET_invite_tree(
  req: any,
  res: any
): Promise<void> {
  try {
    const zid = parseInt(req.p.zid);
    const uid = req.p.uid;
    
    if (!await checkIsOwner(zid, uid)) {
      res.status(403).json({ error: "Not authorized" });
      return;
    }
    
    const tree = await getConversationInviteTree(zid);
    
    // Transform to hierarchical structure
    const buildTree = (codes: any[], parentCode?: string) => {
      return codes
        .filter(c => c.parent_code === parentCode)
        .map(code => ({
          code: code.code,
          wave_number: code.wave_number,
          is_used: !!code.used_by_uid,
          used_at: code.used_at,
          children_generated: code.children_generated,
          created_at: code.created_at,
          children: buildTree(codes, code.code),
        }));
    };
    
    const hierarchicalTree = buildTree(tree, undefined);
    
    res.json({ 
      invite_tree: hierarchicalTree,
      total_codes: tree.length,
      codes_used: tree.filter(c => c.used_by_uid).length,
      max_wave: Math.max(...tree.map(c => c.wave_number)),
    });
  } catch (error: any) {
    logger.error("Error getting invite tree:", error);
    res.status(500).json({ error: error.message });
  }
}

// Get user's invite codes to share
export async function handle_GET_user_invite_codes(
  req: any,
  res: any
): Promise<void> {
  try {
    const conversation_id = parseInt(req.p.conversation_id);
    const uid = req.p.uid;
    
    if (!uid) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    
    const codes = await getUserInviteCodes(conversation_id, uid);
    
    res.json({ 
      codes,
      share_urls: codes.map(code => ({
        code,
        url: `/invite/${code}`,
        message: `Join the conversation: ${process.env.SERVICE_URL}/invite/${code}`,
      })),
    });
  } catch (error: any) {
    logger.error("Error getting user invite codes:", error);
    res.status(500).json({ error: error.message });
  }
}