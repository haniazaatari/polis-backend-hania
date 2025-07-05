# Multi-Generational Invite Code System Design

## Executive Summary

This document outlines the design for a sophisticated invite code system for Polis conversations that enables snowball sampling at scale. The system allows conversation owners to generate invite codes that automatically create subsequent generations of codes, enabling organic growth while maintaining control and auditability.

## TODOs

- [ ] Finalize database schema design
- [ ] Design API endpoints for code generation and redemption
- [ ] Create code generation algorithm (format, uniqueness, readability)
- [ ] Design wave generation scheduling system (cron job or event-driven)
- [ ] Plan XID integration strategy
- [ ] Design rate limiting and abuse prevention mechanisms
- [ ] Create monitoring and analytics dashboards
- [ ] Define migration strategy from suzinvites
- [ ] Design UI/UX for code management interface
- [ ] Plan testing strategy for country-scale conversations
- [ ] Document security considerations and threat model
- [ ] Design backup and recovery procedures

## Background

### Current State

Polis currently has two identity/invitation systems:

1. **XID (External ID) System**: Provides persistent identity across devices without requiring user accounts
2. **Suzinvites (Single-Use Invites)**: One-time invitation tokens for controlled access

### Problem Statement

Current limitations:
- Suzinvites are single-use and don't scale organically
- No built-in mechanism for participants to invite others
- Difficult to implement snowball sampling methodology at scale
- Limited visibility into invitation chains and network effects

### Solution Overview

A multi-generational invite code system where:
- Each conversation has its own invite code tree
- Codes automatically unlock the ability to generate more codes after a time delay
- Full genealogy tracking enables understanding of growth patterns
- Integration with existing XID system for identity persistence

## Understanding Existing Systems

### XID System Deep Dive

**Purpose**: External ID system that allows conversation owners to track participants across devices without requiring Polis accounts.

**Key Components**:

1. **Database Tables**:
   - `xids`: Maps external IDs to Polis users within an owner's scope
   - `xid_whitelist`: Optional access control for specific XIDs

2. **Core Functions**:
   - `createXidRecord()`: Links external ID to Polis user
   - `doXidConversationIdAuth()`: Authenticates participants via XID
   - `getXidRecordByXidOwnerId()`: Retrieves/creates XID records

3. **Architecture Insights**:
   - XIDs are scoped to conversation owners (not global)
   - Automatic user creation for new XIDs
   - Supports metadata (name, email, profile image)
   - Used in embed code via data attributes

4. **Integration Points**:
   - `/api/v3/participationInit`
   - Vote and comment endpoints
   - Export functionality

### Suzinvite System Deep Dive

**Purpose**: Single-use invitation tokens for controlled, one-time access to conversations.

**Key Components**:

1. **Database Table**:
   ```sql
   suzinvites (
     owner: conversation owner
     zid: conversation ID
     xid: external ID for invited user
     suzinvite: unique token
   )
   ```

2. **Core Functions**:
   - `generateSUZinvites()`: Creates cryptographically secure tokens
   - `getSUZinviteInfo()`: Validates tokens
   - `deleteSuzinvite()`: Ensures single use by deletion

3. **Architecture Insights**:
   - Tokens deleted immediately after use
   - Links to XID for identity tracking
   - URL format: `/ot/{conversation_id}/{token}`
   - Supports bulk generation

## Proposed Multi-Generational Invite System

### Design Principles

1. **Scalability First**: Must handle country-scale conversations (millions of participants)
2. **Auditability**: Complete genealogy of invitation chains
3. **Flexibility**: Configurable rules per conversation and wave
4. **Integration**: Seamless with existing XID infrastructure
5. **Security**: Prevent abuse while enabling growth

### Database Schema

```sql
-- Main invite codes table
CREATE TABLE invite_codes (
    code_id SERIAL PRIMARY KEY,
    code VARCHAR(64) UNIQUE NOT NULL,
    conversation_id INTEGER NOT NULL REFERENCES conversations(zid),
    owner_uid INTEGER NOT NULL REFERENCES users(uid),
    
    -- Generational tracking
    wave_number INTEGER NOT NULL DEFAULT 0,
    parent_code_id INTEGER REFERENCES invite_codes(code_id),
    
    -- Creator and user info
    creator_uid INTEGER REFERENCES users(uid),
    claimed_by_uid INTEGER REFERENCES users(uid),
    
    -- Timing
    created_at BIGINT DEFAULT now_as_millis(),
    claimed_at BIGINT,
    next_wave_unlock_at BIGINT,
    
    -- Limits and status
    max_child_codes INTEGER DEFAULT 5,
    child_codes_generated INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    
    -- Metadata
    metadata JSONB,
    
    INDEX idx_conversation_wave (conversation_id, wave_number),
    INDEX idx_parent_code (parent_code_id),
    INDEX idx_code_lookup (code, is_active)
);

-- Generation audit trail
CREATE TABLE invite_code_generations (
    generation_id SERIAL PRIMARY KEY,
    parent_code_id INTEGER NOT NULL REFERENCES invite_codes(code_id),
    wave_number INTEGER NOT NULL,
    generated_at BIGINT DEFAULT now_as_millis(),
    codes_generated INTEGER NOT NULL,
    
    INDEX idx_parent_wave (parent_code_id, wave_number)
);

-- Per-conversation configuration
CREATE TABLE invite_code_config (
    conversation_id INTEGER PRIMARY KEY REFERENCES conversations(zid),
    hours_between_waves INTEGER DEFAULT 24,
    wave_limits JSONB DEFAULT '{
        "1": {"max_codes": 10, "hours_delay": 24},
        "2": {"max_codes": 5, "hours_delay": 48},
        "3": {"max_codes": 3, "hours_delay": 72}
    }',
    max_wave_number INTEGER DEFAULT 10,
    max_total_participants INTEGER,
    auto_generate_waves BOOLEAN DEFAULT true,
    require_participation_before_generation BOOLEAN DEFAULT false,
    created_at BIGINT DEFAULT now_as_millis(),
    updated_at BIGINT DEFAULT now_as_millis()
);

-- Participant tracking
CREATE TABLE participant_invite_chain (
    pid VARCHAR(256) NOT NULL,
    invite_code_id INTEGER NOT NULL REFERENCES invite_codes(code_id),
    joined_at BIGINT DEFAULT now_as_millis(),
    conversation_id INTEGER NOT NULL,
    wave_number INTEGER NOT NULL,
    PRIMARY KEY (pid, conversation_id),
    INDEX idx_invite_chain (invite_code_id)
);
```

### System Architecture

#### Code Generation Strategy

1. **Format**: `{prefix}-{wave}-{random}-{checksum}`
   - Prefix: 2-3 chars identifying conversation
   - Wave: Single char/digit for wave number
   - Random: 6-8 alphanumeric characters
   - Checksum: 2 chars for validation

2. **Uniqueness**: Enforced by database constraint + generation retry logic

#### Wave Generation Process

1. **Scheduled Job** (runs every N minutes):
   ```typescript
   async function processWaveGeneration() {
     // Find all codes eligible for wave generation
     const eligibleCodes = await getCodesReadyForNextWave();
     
     for (const parentCode of eligibleCodes) {
       const config = await getConversationConfig(parentCode.conversation_id);
       const waveConfig = config.wave_limits[parentCode.wave_number + 1];
       
       if (shouldGenerateWave(parentCode, waveConfig)) {
         await generateChildCodes(parentCode, waveConfig);
       }
     }
   }
   ```

2. **Generation Rules**:
   - Check if enough time has passed
   - Verify participation requirements if enabled
   - Respect per-wave limits
   - Create audit record

#### Integration with XID

When a user redeems an invite code:

1. Generate unique XID for the participant
2. Create XID record linking to conversation owner
3. Mark invite code as claimed
4. Create participant_invite_chain record
5. Set up next wave generation timer

### API Design

#### Endpoints

1. **POST /api/v3/conversations/{zid}/invite-codes/generate**
   - For conversation owners to generate root/manual codes
   
2. **POST /api/v3/invite/redeem**
   - Redeem an invite code and join conversation
   
3. **GET /api/v3/conversations/{zid}/invite-codes**
   - List all codes for a conversation (admin only)
   
4. **GET /api/v3/invite-codes/{code}/genealogy**
   - Get the invitation tree for analytics

5. **PUT /api/v3/conversations/{zid}/invite-config**
   - Update wave generation rules

### Security Considerations

1. **Rate Limiting**:
   - Per-IP limits on code redemption
   - Per-user limits on manual generation
   - Exponential backoff for failed attempts

2. **Abuse Prevention**:
   - Anomaly detection for unusual growth patterns
   - Ability to freeze/revoke entire branches
   - Configurable max participants per conversation

3. **Privacy**:
   - Codes don't reveal conversation content
   - Participant identity protected via XID abstraction
   - Optional anonymization of invitation chains

### Migration Strategy

1. **Phase 1**: Deploy alongside suzinvites
   - New conversations use new system
   - Existing conversations can opt-in

2. **Phase 2**: Migrate active conversations
   - Convert suzinvites to wave 0 codes
   - Preserve invitation history

3. **Phase 3**: Deprecate suzinvites
   - Update all references
   - Archive old data

### Monitoring and Analytics

Key metrics to track:
- Wave progression rates
- Redemption success rates
- Growth velocity by wave
- Abandonment patterns
- Geographic spread (via IP)
- Time-to-redemption distributions

### Testing Strategy

1. **Unit Tests**:
   - Code generation uniqueness
   - Wave calculation logic
   - Permission checks

2. **Integration Tests**:
   - End-to-end redemption flow
   - XID integration
   - Wave generation scheduling

3. **Load Tests**:
   - Simulate country-scale growth
   - Test database performance
   - Verify queue processing

4. **Chaos Tests**:
   - Node failures during generation
   - Database connection issues
   - Clock skew scenarios

## Implementation Phases

### Phase 1: Core Infrastructure (Weeks 1-2)
- Database schema implementation
- Basic code generation/redemption
- XID integration

### Phase 2: Wave Generation (Weeks 3-4)
- Scheduling system
- Generation rules engine
- Basic monitoring

### Phase 3: Admin Tools (Weeks 5-6)
- Management UI
- Analytics dashboards
- Migration tools

### Phase 4: Scale Testing (Weeks 7-8)
- Load testing
- Performance optimization
- Security hardening

## Open Questions

1. Should we support code revocation? If so, should it cascade to children?
2. How do we handle conversation closure with active codes?
3. Should participants see their invitation genealogy?
4. Do we need different code formats for different wave numbers?
5. How do we prevent gaming of the system while maintaining organic growth?

## References

- Current XID implementation: `/server/src/conversation.ts`, `/server/src/user.ts`
- Suzinvite implementation: `/server/src/server.ts` (generateSUZinvites function)
- Database schemas: `/server/postgres/migrations/`
- Client-side integration: `/client-participation/js/strings/en_us.js`

## Conclusion

This multi-generational invite system will enable Polis to scale conversations organically while maintaining control and auditability. By building on the existing XID infrastructure and learning from suzinvites, we can create a robust system that supports snowball sampling at country scale.