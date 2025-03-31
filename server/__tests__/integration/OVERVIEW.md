# Integration Tests Overview

This directory contains integration tests for the Polis API server. The tests are organized by endpoint or feature domain.

## Test Coverage Summary

We have implemented comprehensive integration tests covering most of the critical API endpoints and features of the Polis server:

- **Conversation Management**: Creating, reading, updating, and managing conversations
- **Participant Management**: User registration, login, initialization, and participation
- **Commenting System**: Creating and moderating comments
- **Voting System**: Casting and retrieving votes
- **Metadata**: Managing participant and question metadata
- **Reports**: Creating and managing reports
- **Data Export**: Exporting conversation data in various formats

## Test Organization

Tests are organized by logical feature areas to make them easier to maintain and extend:

1. **Authentication**: `auth.test.js`, `xid-auth.test.js`
2. **Conversations**: `conversation.test.js`, `conversation-activity.test.js`, `conversation-preload.test.js`, `conversation-stats.test.js`
3. **Comments**: `comment.test.js`
4. **Votes**: `vote.test.js`
5. **Metadata**: `participant-metadata.test.js`
6. **Reports & Exports**: `reports.test.js`, `data-export.test.js`

## Test Infrastructure

The tests utilize a shared testing infrastructure defined in the `__tests__/setup` directory:

- **API Helpers**: Common functions for API operations like creating conversations, comments, and submitting votes
- **Database Setup**: Functions for setting up and tearing down test database state
- **Test Server**: A dedicated test server instance that runs during tests

## Running Tests

To run all integration tests:

```bash
npm test -- __tests__/integration
```

To run a specific test:

```bash
npm test -- __tests__/integration/[test-name].test.js
```

## Next Steps

Areas that could use additional test coverage:

1. **Math & Analytics**: Additional tests for the mathematical analysis features
2. **Moderation**: More comprehensive testing of moderation capabilities
3. **Error Handling**: More tests for edge cases and error conditions
4. **Performance**: Load testing and performance benchmarks

## API Checklist

See the `CHECKLIST.md` file for a detailed list of API endpoints and their test coverage status.
