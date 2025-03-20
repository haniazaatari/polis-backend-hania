# Integration Tests

This directory contains integration tests for the Polis API. These tests verify the correctness of API endpoints by making actual HTTP requests to the server and checking the responses.

## Structure

Each test file focuses on a specific aspect of the API:

- `auth.test.js` - Authentication endpoints
- `comment.test.js` - Comment creation and retrieval endpoints
- `conversation.test.js` - Conversation creation and management endpoints
- `health.test.js` - Health check endpoints
- `participation.test.js` - Participation and initialization endpoints
- `vote.test.js` - Voting endpoints

## Shared Test Helpers

To maintain consistency and reduce duplication, all test files use shared helper functions from `__tests__/setup/api-test-helpers.js`. These include:

### API Constants

- `API_PORT` - The port for the API (defaults to 5000)
- `API_URL` - The base URL for the API (defaults to localhost with port from env or 5000)
- `API_PREFIX` - The API version prefix ('/api/v3')

### Helper Functions

- `generateTestUser()` - Creates random user data for registration
- `generateRandomXid()` - Creates random external IDs for testing
- `attachAuthToken()` - Attaches authentication tokens to requests
- `createTestConversation()` - Creates a conversation with the specified options
- `createTestComment()` - Creates a comment in a conversation
- `wait()` - Pauses execution for a specified time
- `retryRequest()` - Retries a request with backoff
- `initializeParticipant()` - Initializes an anonymous participant for voting
- `initializeParticipantWithXid()` - Initializes a participant for voting with an external ID
- `registerAndLoginUser()` - Registers and logs in a user in one step
- `submitVote()` - Submits a vote on a comment
- `getVotes()` - Retrieves votes for a conversation
- `getMyVotes()` - Retrieves a participant's votes. NOTE: In the legacy implementation, this seems to always return an empty array.

## Participation Tests

The `participation.test.js` file contains tests for the participation-related endpoints:

### GET /participationInit

This endpoint initializes participation for a conversation. It's typically the first API call made when a user joins a conversation. The tests verify:

- Authenticated access works
- Unauthenticated access works for public conversations
- Can initialize without a conversation ID
- Supports parameters like `ptptoiLimit` and `lang`
- Works with external IDs (xid)

### GET /participation

This endpoint retrieves participation data for a conversation. The tests verify:

- Authenticated access works
- Unauthenticated access fails with 403
- Missing conversation ID returns 400
- Strict mode works
- Participation with external IDs works
- Full participation flow (init → get participation → vote)

## Vote Tests

The `vote.test.js` file tests the voting-related endpoints:

### POST /votes

- Creates votes for comments
- Supports anonymous and registered users
- Properly handles moderation states

### GET /votes

- Retrieves votes for a conversation
- Filters by moderation state

### GET /votes/me

- Retrieves a participant's votes for a conversation

## Comment Tests

The `comment.test.js` file tests the comment-related endpoints:

### POST /comments

- Creates comments in conversations
- Validates input parameters

### GET /comments

- Retrieves comments with various filters
- Supports moderation parameters
- Handles pagination

## Running Tests

To run these tests:

```bash
npm test -- __tests__/integration/participation.test.js
```

Or to run all integration tests:

```bash
npm test -- __tests__/integration
```

## Known Issues

### Database Schema Issues

The test suite currently handles several known database issues:

1. ~**Vote query syntax error**: When creating comments with a vote value of 0, the server returns an "unexpected db query syntax" error. As a workaround, the tests use a vote value of 1 when creating comments.~ (resolved)

2. **Missing notification_tasks column**: The server crashes when trying to access a non-existent `task_type` column in the `notification_tasks` table. This causes ECONNRESET errors in the tests. The tests are designed to handle these connection resets gracefully.

If you're seeing a lot of skipped tests or ECONNRESET errors, check the server logs for database-related issues. You may need to update your database schema or modify the tests to work with your specific database configuration.
