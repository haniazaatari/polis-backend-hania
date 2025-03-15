# Authentication in 2olis

This document outlines the authentication mechanisms used in 2olis, with a particular focus on participant authentication.

## Authentication Types

The system supports several authentication methods:

1. **Session Token Cookies** - Primary authentication method for regular users
2. **API Key Authentication** - For system integrations
3. **XID-based Authentication** - For external systems embedding Polis
4. **Basic Auth** - Limited support for API integrations

## User Authentication

Standard user authentication follows a typical pattern:

1. User registers or logs in with email and password
2. Server sets a session token cookie
3. Subsequent requests include this cookie for authentication
4. Server validates token on each request

## Participant Authentication

Participant authentication is more complex and follows a different flow:

### Key Concepts

- **Permanent Cookie (pc)**: Identifies a browser/device
- **Participant ID (pid)**: Numeric identifier for a participant in a specific conversation 
- **External ID (xid)**: Optional identifier provided by an external system
- **Anonymous Group ID (agid)**: Used for anonymous participants (default = 1)

### Anonymous Participant Authentication Flow

The standard flow for anonymous participants works as follows:

1. **Initialization**: 
   - Client calls `/participationInit?conversation_id=xyz&pid=mypid&lang=acceptLang`
   - Server sets a `pc` cookie (permanent cookie)
   - Server responds with conversation data and first comment to be voted on
   - No permanent `pid` is assigned yet

2. **First Vote/Comment**:
   - User submits first vote with payload including:
     - `conversation_id` (zinvite)
     - `tid` (comment ID)
     - `vote` (-1 for agree, 1 for disagree, 0 for pass)
     - `agid=1` (critical for anonymous participation)
     - `pid=mypid` (temporary placeholder value)
   - Server creates anonymous user via `createAnonymousUser`
   - Server assigns real `pid` and returns it as `currentPid` in response
   - Server sets additional cookies: `token2`, `uc`, `uid2`

3. **Subsequent Votes**:
   - Client sends all cookies from previous responses
   - Client continues to use same payload structure (oddly, keeping the placeholder `pid=mypid` works)
   - Server validates participant based on cookies
   - Server continues returning next comments

### XID-based Authentication Flow

For embedded use cases, external systems can authenticate participants using an XID:

1. **Initialization with XID**:
   - Client calls `/participationInit?conversation_id=xyz&xid=external_id&pid=mypid&lang=acceptLang`
   - Server sets a `pc` cookie
   - Server associates the XID with a participant for this conversation

2. **First Vote with XID**:
   - User submits first vote with XID in payload:
     - Same fields as anonymous participant
     - Must include `agid=1` for proper anonymous handling
     - Include `xid` parameter to maintain consistent identity

3. **Subsequent Requests with XID**:
   - Client sends all cookies from previous responses
   - Client includes same XID in subsequent requests
   - Server maintains consistent participant identity across sessions

### Key Parameters for Participant Authentication

- **conversation_id**: The conversation identifier (zinvite)
- **tid**: The comment ID being voted on
- **vote**: The vote value (-1=agree, 1=disagree, 0=pass)
- **agid=1**: Critical for anonymous participant authentication
- **pid=mypid**: Initial placeholder value (server assigns real pid later)
- **xid**: External identifier for consistent participant tracking

### Essential Cookies for Participant Authentication

- **pc**: Permanent cookie identifying the browser/device
- **token2**: Session token for the participant
- **uc**: User cookie
- **uid2**: User ID cookie
- **ct**: Additional context cookie

## Common Authentication Errors

- **polis_err_auth_token_error_1241**: Occurs when there's an issue creating an anonymous user, often due to cookie handling issues
- **polis_err_auth_token_error_2343**: Session creation/cookie setting failure
- **polis_err_auth_token_not_supplied**: Missing required authentication token

## Cookie Handling

Cookie management is critical for participant tracking:

- All cookies must be forwarded between requests
- The server may add new cookies during the participant authentication flow
- Different cookies serve different purposes, but all should be preserved
- The full cookie chain establishes participant identity

## Testing Considerations

When testing the system:

1. **Cookie Preservation**: Tests must preserve and forward ALL cookies between requests
2. **First Vote Importance**: The first vote establishes participant identity
3. **agid=1 Parameter**: Always include for anonymous participants
4. **XID Consistency**: When using XIDs, use the same value throughout a test
5. **Error Handling**: Implement retry logic for transient authentication issues

The most reliable test flow for participant authentication is:

1. Call `/participationInit` to get initial cookies
2. Submit first vote with `agid=1` and appropriate parameters
3. Extract all cookies from response
4. Use these cookies in all subsequent requests
5. For XID-based testing, use a consistent XID throughout

## Legacy vs. Modular Server Differences

There may be subtle differences in authentication handling between the legacy and modular servers:

1. Cookie setting behavior may vary
2. Error responses might differ in format
3. Parameter handling might have subtle differences
4. Both should maintain the same core participant identification flow

Tests should be flexible enough to handle these differences while ensuring the core authentication flow remains intact.
