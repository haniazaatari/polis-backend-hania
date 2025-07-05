# Minimal Invite Code System - MVP Implementation Guide

## Overview

This document describes the absolute minimal implementation of a multi-generational invite code system for Polis. This MVP can be built in 1-2 days and provides the foundation for the full system described in `invite-code-system-design.md`.

## Core Concept

- Each conversation gets invite codes
- Codes can have "children" codes (creating a tree)
- Admin manually unlocks the next generation
- Everything else is deferred

## Database Schema (One Table!)

```sql
CREATE TABLE invite_codes (
    code_id SERIAL PRIMARY KEY,
    code VARCHAR(32) UNIQUE NOT NULL,
    conversation_id INTEGER NOT NULL REFERENCES conversations(zid),
    
    -- Who made it and who used it
    parent_code_id INTEGER REFERENCES invite_codes(code_id),
    created_by_uid INTEGER REFERENCES users(uid),
    used_by_uid INTEGER REFERENCES users(uid),
    
    -- Simple wave tracking
    wave_number INTEGER NOT NULL DEFAULT 0,
    
    -- Timestamps
    created_at BIGINT DEFAULT now_as_millis(),
    used_at BIGINT,
    
    -- Can this code generate children?
    can_generate_children BOOLEAN DEFAULT false,
    children_generated INTEGER DEFAULT 0,
    
    INDEX idx_code (code),
    INDEX idx_conversation (conversation_id),
    INDEX idx_parent (parent_code_id)
);
```

## Implementation Plan

### Step 1: Database Migration

Create file: `server/postgres/migrations/000000_create_invite_codes.sql`

```sql
CREATE TABLE invite_codes (
    -- Schema from above
);

-- Create root invite for existing conversations (optional)
INSERT INTO invite_codes (code, conversation_id, created_by_uid, wave_number)
SELECT 
    'ROOT-' || SUBSTRING(MD5(RANDOM()::TEXT), 1, 8),
    zid,
    owner,
    0
FROM conversations
WHERE -- Add conditions if you only want some conversations
```

### Step 2: Core Server Functions

Add to `server/src/server.ts` (near the suzinvite functions):

```typescript
import { v4 as uuidv4 } from "uuid";

// Generate a unique invite code using UUID v4
function generateInviteCode(): string {
  // Generate a UUID and take the first 8 characters for a shorter, more user-friendly code
  const uuid = uuidv4().replace(/-/g, '').toUpperCase();
  const shortCode = uuid.substring(0, 8);
  
  // Format as XXXX-XXXX for readability
  return shortCode.match(/.{1,4}/g).join('-');
  
  // Alternative: Use full UUID for maximum uniqueness (less user-friendly)
  // return uuidv4();
}

// Create a new invite code
async function createInviteCode(
  conversationId: number,
  parentCodeId: number | null,
  createdByUid: number
): Promise<string> {
  const code = generateInviteCode();
  
  // Get parent wave number if this is a child
  let waveNumber = 0;
  if (parentCodeId) {
    const parent = await pgQuerySingle(
      "SELECT wave_number FROM invite_codes WHERE code_id = $1",
      [parentCodeId]
    );
    waveNumber = parent.wave_number + 1;
  }
  
  await pgQuery(`
    INSERT INTO invite_codes 
    (code, conversation_id, parent_code_id, created_by_uid, wave_number)
    VALUES ($1, $2, $3, $4, $5)
  `, [code, conversationId, parentCodeId, createdByUid, waveNumber]);
  
  return code;
}

// Redeem an invite code
async function redeemInviteCode(code: string, uid: number): Promise<ConversationInfo> {
  // Get invite info
  const invite = await pgQuerySingle(`
    SELECT code_id, conversation_id, used_by_uid 
    FROM invite_codes 
    WHERE code = $1
  `, [code]);
  
  if (!invite) {
    throw new Error("Invalid invite code");
  }
  
  if (invite.used_by_uid) {
    throw new Error("Invite code already used");
  }
  
  // Mark as used
  await pgQuery(`
    UPDATE invite_codes 
    SET used_by_uid = $1, used_at = $2 
    WHERE code_id = $3
  `, [uid, Date.now(), invite.code_id]);
  
  // Get conversation info and return it
  return await getConversationInfo(invite.conversation_id);
}

// Manually generate child codes
async function generateChildCodes(
  parentCodeId: number,
  count: number = 5,
  requestingUid: number
): Promise<string[]> {
  // Verify the user can do this (owns the conversation or is admin)
  const parent = await pgQuerySingle(`
    SELECT c.owner, ic.conversation_id, ic.children_generated
    FROM invite_codes ic
    JOIN conversations c ON ic.conversation_id = c.zid
    WHERE ic.code_id = $1
  `, [parentCodeId]);
  
  if (parent.owner !== requestingUid) {
    throw new Error("Not authorized");
  }
  
  // Generate the child codes
  const codes = [];
  for (let i = 0; i < count; i++) {
    const code = await createInviteCode(
      parent.conversation_id,
      parentCodeId,
      requestingUid
    );
    codes.push(code);
  }
  
  // Update parent's children count
  await pgQuery(`
    UPDATE invite_codes 
    SET children_generated = children_generated + $1,
        can_generate_children = true
    WHERE code_id = $2
  `, [count, parentCodeId]);
  
  return codes;
}
```

### Step 3: API Endpoints

Add these endpoints to `server/src/server.ts`:

```typescript
// 1. Create root invite code (admin only)
app.post("/api/v3/conversations/:zid/invite-codes", async (req, res) => {
  const zid = req.params.zid;
  const uid = req.session.uid;
  
  // Check if user owns conversation
  if (!await isConversationOwner(zid, uid)) {
    return res.status(403).send("Not authorized");
  }
  
  const code = await createInviteCode(zid, null, uid);
  res.json({ code });
});

// 2. Redeem invite code
app.post("/api/v3/invite/redeem", async (req, res) => {
  const { code } = req.body;
  const uid = req.session.uid || await createDummyUser(); // Create user if needed
  
  try {
    const conversationInfo = await redeemInviteCode(code, uid);
    
    // Create XID record for tracking
    const xid = `invite-${code}-${uid}`;
    await createXidRecord(conversationInfo.owner, uid, xid);
    
    res.json({ 
      success: true, 
      conversation_id: conversationInfo.zid,
      redirect_url: `/c/${conversationInfo.conversation_id}`
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 3. Generate child codes (manual trigger)
app.post("/api/v3/invite-codes/:code_id/generate-children", async (req, res) => {
  const codeId = req.params.code_id;
  const uid = req.session.uid;
  const count = req.body.count || 5;
  
  try {
    const codes = await generateChildCodes(codeId, count, uid);
    res.json({ generated_codes: codes });
  } catch (err) {
    res.status(403).json({ error: err.message });
  }
});

// 4. Get invite tree (for admin view)
app.get("/api/v3/conversations/:zid/invite-tree", async (req, res) => {
  const zid = req.params.zid;
  const uid = req.session.uid;
  
  if (!await isConversationOwner(zid, uid)) {
    return res.status(403).send("Not authorized");
  }
  
  const tree = await pgQuery(`
    WITH RECURSIVE invite_tree AS (
      SELECT *, 0 as level
      FROM invite_codes
      WHERE conversation_id = $1 AND parent_code_id IS NULL
      
      UNION ALL
      
      SELECT ic.*, it.level + 1
      FROM invite_codes ic
      JOIN invite_tree it ON ic.parent_code_id = it.code_id
    )
    SELECT 
      code_id, code, wave_number, level,
      used_by_uid IS NOT NULL as is_used,
      children_generated,
      created_at, used_at
    FROM invite_tree
    ORDER BY level, created_at
  `, [zid]);
  
  res.json({ invite_tree: tree });
});
```

### Step 4: Simple Admin UI

Add to the conversation admin page:

```html
<!-- In client-admin/src/components/conversation-admin.js -->
<div className="invite-codes-section">
  <h3>Invite Codes</h3>
  <button onClick={generateRootCode}>Generate Root Invite Code</button>
  
  <div className="invite-tree">
    {inviteTree.map(node => (
      <div 
        key={node.code_id} 
        style={{marginLeft: node.level * 20}}
        className={node.is_used ? 'used' : 'unused'}
      >
        <span>{node.code}</span>
        <span>Wave {node.wave_number}</span>
        <span>{node.is_used ? '✓ Used' : 'Available'}</span>
        {node.is_used && (
          <button onClick={() => generateChildren(node.code_id)}>
            Generate 5 Child Codes
          </button>
        )}
      </div>
    ))}
  </div>
</div>
```

### Step 5: Client Integration

For users to redeem codes, add a simple route:

```javascript
// In client-participation/src/router.js
router.get('/invite/:code', async (req, res) => {
  // Render a page with auto-submit form
  res.render('invite-redeem', {
    code: req.params.code,
    api_url: '/api/v3/invite/redeem'
  });
});
```

## Testing the MVP

1. **Create a conversation**
2. **Generate root code** via admin UI
3. **Share the code** as URL: `https://pol.is/invite/ABCD-1234`
4. **User visits URL** → Automatically joins conversation
5. **Admin sees user** joined in invite tree
6. **Admin clicks** "Generate Child Codes"
7. **Original user** can now share their child codes

## What This Gives You

- ✅ Working invite system TODAY
- ✅ Full tracking of who invited whom
- ✅ Manual control over growth
- ✅ Foundation to build on
- ✅ Integration with existing XID system

## What's Missing (Intentionally)

- ❌ Automatic wave generation
- ❌ Time delays
- ❌ Complex permissions
- ❌ Bulk operations
- ❌ Analytics dashboard
- ❌ Email integration

## Next Steps After MVP

1. **Test with real users** - See how the manual system works
2. **Add automation** - Scheduled job for wave generation
3. **Add constraints** - Time delays, participation requirements
4. **Build analytics** - Visualization of invite trees
5. **Scale testing** - Ensure it works for large conversations

## Implementation Checklist

- [ ] Create database migration
- [ ] Add server functions (copy from this doc)
- [ ] Add API endpoints
- [ ] Update admin UI
- [ ] Create invite redemption page
- [ ] Test full flow
- [ ] Document for users

## Estimated Time

- Database + Backend: 4-6 hours
- Admin UI: 2-3 hours  
- Testing: 2-3 hours
- **Total: 1-2 days for working MVP**

## Code Locations Reference

- Database migrations: `/server/postgres/migrations/`
- Server endpoints: `/server/src/server.ts`
- Admin UI: `/client-admin/src/components/`
- Participation client: `/client-participation/src/`
- XID integration: Use existing `createXidRecord()` from `/server/src/conversation.ts`

## Success Criteria

You know the MVP is working when:
1. Admin can generate a root invite code
2. User can join via invite URL
3. Admin sees the user in the invite tree
4. Admin can manually generate child codes
5. Process repeats for multiple generations

---

This MVP gives you a working system to test the concept without the complexity of automation, configuration, or scale concerns. Build this first, learn from it, then add features based on real usage.