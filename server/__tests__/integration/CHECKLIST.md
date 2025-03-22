# Checklist for Integration Tests

This checklist tracks API endpoints and functional domains that should be tested in the integration test suite. This ensures comprehensive coverage of the API and helps identify gaps in testing.

## Legend

- ✅ Fully tested
- 🔶 Partially tested
- ❌ Not tested yet
- ⛔️ Expected to fail, or has known issues

## Authentication

### Auth Endpoints

- ✅ POST /auth/new - User registration
- ✅ POST /auth/login - User login
- ✅ POST /auth/deregister - User logout
- ✅ POST /auth/pwresettoken - Password reset token
- ✅ GET /auth/pwreset - Password reset page
- ✅ POST /auth/pwreset - Process password reset
- ❌ GET /verify - Email verification

### Auth Features

- ✅ Anonymous participation
- ✅ Authenticated participation
- ✅ Token-based authentication
- ✅ Cookie-based authentication
- ❌ XID-based authentication
- ✅ Password reset flow

## Conversations

### Conversation Management

- ✅ POST /conversations - Create conversation
- ✅ GET /conversations - List conversations
- ✅ GET /conversation/:conversation_id - Get conversation details
- ✅ PUT /conversations - Update conversation
- ⛔️ POST /conversation/close - Close conversation
- ❌ POST /reserve_conversation_id - Reserve conversation ID

### Conversation Features

- ✅ Public vs. private conversations
- ⛔️ Conversation closure
- ❌ Conversation sharing settings
- ❌ Conversation monitoring
- ❌ Conversation embedding

## Comments

### Comment Endpoints

- ✅ POST /comments - Create comment
- ✅ GET /comments - List comments
- ⛔️ GET /comments/translations - Get comment translations
- ✅ PUT /comments - Update comment

### Comment Features

- ✅ Comment creation
- ✅ Comment retrieval with filters
- ✅ Comment moderation
- ❌ Comment rejection
- ⛔️ Comment translation

## Participation

### Participation Endpoints

- ✅ GET /participationInit - Initialize participation
- ✅ GET /participation - Get participation data
- ❌ GET /nextComment - Get next comment for voting
- ❌ POST /ptpt - Participant metadata
- ❌ PUT /ptpt - Update participant metadata

### Participation Features

- ✅ Anonymous participation
- ✅ Authenticated participation
- ✅ XID-based participation
- ❌ Participation with custom metadata

## Voting

### Vote Endpoints

- ✅ POST /votes - Submit vote
- ✅ GET /votes - Get votes
- ✅ GET /votes/me - Get my votes

### Vote Features

- ✅ Anonymous voting
- ✅ Authenticated voting
- ✅ Vote retrieval
- ❌ Vote updating

## Math and Analysis

### Math Endpoints

- ❌ GET /math/pca - Principal Component Analysis
- ❌ GET /math/correlationMatrix - Get correlation matrix

### Report Endpoints

- ❌ GET /report - Get report data
- ❌ GET /snapshot - Get conversation snapshot

## System and Utilities

### Health Endpoints

- ✅ GET /testConnection - Test connectivity
- ✅ GET /testDatabase - Test database connection

### Context and Metadata

- ✅ GET /contexts - Get available contexts
- ❌ GET /domainWhitelist - Get whitelisted domains

### Miscellaneous

- ✅ POST /tutorial - Track tutorial steps
- ❌ POST /einvites - Send email invites
- ❌ GET /tryCookie - Test cookie functionality
- ❌ GET /perfStats_9182738127 - Performance statistics

## Extended Features

### User Management

- ❌ GET /users - List users (admin)
- ❌ PUT /users - Update user (admin)
- ❌ DELETE /users - Delete user
- ❌ GET /user/:user_id - Get user profile

### Moderation and Administration

- ❌ POST /moderate/comment - Moderate comment
- ❌ POST /moderate/conversation - Moderate conversation
- ❌ GET /metadata - Get metadata for admin
- ❌ POST /metadata - Set metadata for admin

### Notifications

- ❌ POST /notify/subscribe - Subscribe to notifications
- ❌ POST /notify/unsubscribe - Unsubscribe from notifications

## Notes on Test Implementation

1. **Legacy Quirks**: Tests should handle the known quirks of the legacy server, including:
   - Plain text responses with content-type: application/json
   - Error responses as text rather than structured JSON
   - Falsy IDs (0 is a valid ID)

2. **Handling Authentication**: Tests should verify all authentication methods:
   - Token-based auth
   - Cookie-based auth
   - Combined auth strategies

3. **Coverage Strategy**: Focus on:
   - Core user flows first
   - Edge cases and validation
   - Error handling
   - Authentication and authorization

4. **Known Issues**: Be aware of potential stability issues with:
   - `/conversation/close` endpoint (may hang)
   - `/auth/deregister` endpoint (may timeout)
   - `/comments/translations` endpoint (always returns 400 error)
