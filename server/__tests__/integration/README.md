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

## Helper Functions

The test files include several helper functions for test setup:

- `generateTestUser()` - Creates random user data for registration
- `generateRandomXid()` - Creates random external IDs for testing
- `createTestConversation()` - Creates a conversation with the specified options
- `createTestComment()` - Creates a comment in a conversation

## Running Tests

To run these tests:

```bash
npm test -- __tests__/integration/participation.test.js
```

Or to run all integration tests:

```bash
npm test -- __tests__/integration
```

## Database Transactions

Each test is wrapped in a database transaction that is rolled back at the end of the test. This ensures that tests don't interfere with each other and that the database is left in a clean state.

## Known Issues

### Database Schema Issues

The test suite currently handles several known database issues:

1. **Vote query syntax error**: When creating comments with a vote value of 0, the server returns an "unexpected db query syntax" error. As a workaround, the tests use a vote value of 1 when creating comments.

2. **Missing notification_tasks column**: The server crashes when trying to access a non-existent `task_type` column in the `notification_tasks` table. This causes ECONNRESET errors in the tests. The tests are designed to handle these connection resets gracefully.

If you're seeing a lot of skipped tests or ECONNRESET errors, check the server logs for database-related issues. You may need to update your database schema or modify the tests to work with your specific database configuration.
